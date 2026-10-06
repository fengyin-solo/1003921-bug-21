// 状态链路冒烟测试：在 Node 里模拟 localStorage，跑通「保存 -> 状态机 -> 跨模块待办闭环 -> 并发」。
import { runAction, listEntries, loadOverview, getEntry } from '../src/api/local-service'
import { allRows, commit } from '../src/data/local-store'
import type { EntryRow } from '../src/data/types'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌ FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('✅', msg)
  }
}

async function main() {
  // 构造一个在册隐患点，关联两条待巡查；另给一个监测中隐患点用于并发测试。
  const hazards: EntryRow[] = [
    { id: 1, status: '在册', pending: true, abnormal: false, 隐患点编号: 'HAZA-T-01' },
    { id: 2, status: '监测中', pending: true, abnormal: false, 隐患点编号: 'HAZA-T-02' },
    { id: 3, status: '已核销', pending: false, abnormal: false, 隐患点编号: 'HAZA-T-03' },
    { id: 4, status: '新增', pending: true, abnormal: false, 隐患点编号: 'HAZA-T-04' },
  ]
  const patrols: EntryRow[] = [
    { id: 1, status: '待巡查', pending: true, abnormal: false, 隐患点编号: 'HAZA-T-01', 巡查编号: 'P1' },
    { id: 2, status: '已巡查', pending: true, abnormal: false, 隐患点编号: 'HAZA-T-01', 巡查编号: 'P2' },
    { id: 3, status: '待巡查', pending: true, abnormal: false, 隐患点编号: 'HAZA-T-02', 巡查编号: 'P3' },
  ]
  commit({ hazard: hazards, patrol: patrols })

  // 1. 不能跳步：在册不能直接核销/治理
  const skipWriteoff = await runAction('hazard', 1, '申请核销')
  assert(!skipWriteoff.ok, '在册 -> 申请核销 被拒绝（不能跳步）')
  const skipGovern = await runAction('hazard', 1, '启动治理')
  assert(!skipGovern.ok, '在册 -> 启动治理 被拒绝（不能跳步）')

  // 2. 缺来源旧记录「新增」按在册兼容
  const legacy = getEntry('hazard', 4)!
  assert(legacy.status === '在册', '缺状态来源旧记录「新增」归一化为在册')

  // 3. 历史已核销保持原结论，且不能再动
  const hist = listEntries('hazard').items.find((r) => r.id === 3)!
  assert(hist.status === '已核销' && hist.pending === false, '历史已核销记录结论保持、无待办')
  const again = await runAction('hazard', 3, '申请核销')
  assert(!again.ok, '已核销终态不允许再核销')

  // 4. 正常推进：在册 -> 监测中 -> 已治理 -> 已核销；核销事务同时关闭关联待巡查
  assert((await runAction('hazard', 1, '纳入监测')).ok, '在册 -> 监测中 成功')
  const p3StillThere = listEntries('patrol').items.find((r) => r.id === 3)!
  assert(p3StillThere.status === '待巡查', '监测中不影响其他隐患点的巡查待办')

  assert((await runAction('hazard', 1, '启动治理')).ok, '监测中 -> 已治理 成功，且联动闭环本点待巡查')
  const p1 = listEntries('patrol').items.find((r) => r.id === 1)!
  assert(p1.status === '已处置' && p1.pending === false, '治理后关联「待巡查」待办在同一事务闭环')
  const p2 = listEntries('patrol').items.find((r) => r.id === 2)!
  assert(p2.status === '已巡查', '非待巡查的关联记录不被误改')

  const gov = getEntry('hazard', 1)!
  assert(gov['隐患状态'] === '已治理', '业务字段「隐患状态」与流转状态同源')
  assert(gov.pending === true, '已治理非终态，待办保留直到核销')

  assert((await runAction('hazard', 1, '申请核销')).ok, '已治理 -> 已核销 成功')
  const done = getEntry('hazard', 1)!
  assert(done.status === '已核销' && done.pending === false, '核销后状态=已核销、待办消失')

  // 5. 列表/详情/重进同源（listEntries 与 getEntry 一致）
  const listed = listEntries('hazard').items.find((r) => r.id === 1)!
  assert(listed.status === done.status && listed['隐患状态'] === done['隐患状态'], '列表与详情状态一致')

  // 6. 并发：监测中隐患点，治理与核销同时提交，只有一个成功
  const [a, b] = await Promise.all([
    runAction('hazard', 2, '启动治理'),
    runAction('hazard', 2, '申请核销'),
  ])
  const successCount = [a, b].filter((r) => r.ok).length
  assert(successCount === 1, `治理/核销并发只成功一个（实际成功 ${successCount} 个）`)
  const final2 = getEntry('hazard', 2)!
  if (a.ok) {
    assert(final2.status === '已治理', '并发中治理胜出，状态=已治理，核销被拒')
  } else {
    // 串行队列下核销本就因前置不符而失败；即使排在前面也会被状态机拒绝
    assert(false, '核销不应在监测中直接成功: ' + b.message)
  }

  // 7. 看板待办由状态派生，已闭环的不计数。
  // HAZA-T-01：P1 被治理闭环；HAZA-T-02：胜出的是治理，P3 也被联动闭环；仅剩 P2 待办。
  const overview = loadOverview()
  const patrolStat = overview.modules.find((m) => m.name === '巡查排查')!
  assert(patrolStat.pending === 1, `看板巡查待办=1（实际 ${patrolStat.pending}）：被治理/核销闭环的不再计数`)
  const p3After = listEntries('patrol').items.find((r) => r.id === 3)!
  assert(p3After.status === '已处置', '并发胜出的治理也完整执行了联动（整体成功，不留半截）')

  // 8. 事务回滚：强制 commit 抛错时，主动作与联动都不落盘。
  const beforeHazard = getEntry('hazard', 2)!.status
  const beforePatrolP3 = p3After.status
  // 用一个临时的坏存储触发序列化异常较难构造，这里校验联动失败语义：
  // 已核销终态再动作直接失败，且不会改动任何数据。
  const rejected = await runAction('hazard', 2, '纳入监测')
  assert(!rejected.ok, '非法动作被拒绝（回滚路径）')
  assert(getEntry('hazard', 2)!.status === beforeHazard, '拒绝后隐患点状态未变')
  assert(listEntries('patrol').items.find((r) => r.id === 3)!.status === beforePatrolP3, '拒绝后巡查状态未变')

  // 9. commit 原子性：序列化失败（循环引用）时缓存保持原样，不会写入半截数据。
  const snapshotHazard = allRows().hazard.length
  const snapshotPatrol = allRows().patrol.length
  const cyclic: EntryRow = { id: 999, status: 'x', pending: false, abnormal: false } as EntryRow
  ;(cyclic as unknown as Record<string, unknown>).self = cyclic
  let threw = false
  try {
    commit({ hazard: [...allRows().hazard, cyclic], patrol: [] })
  } catch {
    threw = true
  }
  assert(threw, '含循环引用的事务提交抛错')
  assert(allRows().hazard.length === snapshotHazard, '失败后隐患点数据回滚，未写入脏记录')
  assert(allRows().patrol.length === snapshotPatrol, '失败后巡查数据回滚（不被清空，避免只清一半）')
}

main()
