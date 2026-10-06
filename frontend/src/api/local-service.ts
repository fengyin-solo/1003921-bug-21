import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, commitStore, listRows, resetRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 隐患点这类有状态机的模块，待办只看是否还没到终态；
// 普通模块保持旧规则（状态表末位之外都算待办）。
function derivePending(row: EntryRow, meta: ModuleMeta): boolean {
  const flow = meta.lifecycle ?? meta.statuses
  return String(row.status) !== flow[flow.length - 1]
}

// 状态机模块只暴露「当前状态的下一个」动作；已核销等终态无动作可执行。
export function availableActions(meta: ModuleMeta, status: string): string[] {
  if (!meta.lifecycle) {
    return meta.actions
  }
  const index = meta.lifecycle.indexOf(status)
  if (index < 0 || index >= meta.actions.length) {
    // 缺状态来源的旧记录按在册兼容，可从首个动作开始推进
    return meta.lifecycle.includes(status) ? [] : meta.actions.slice(0, 1)
  }
  return [meta.actions[index]]
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)

  if (meta.lifecycle) {
    // 单向推进：只能从当前状态走到相邻的下一状态；终态（已核销）锁死，
    // 历史核销结论不会再被任何动作改写，治理与核销并发时抢不到同一个下一步。
    const step = meta.lifecycle.indexOf(current)
    const nextStep = meta.lifecycle.indexOf(target)
    if (step < 0) {
      // 读取层已把缺来源的旧状态兼容为在册；这里再兜一道，先兼容再推进
      return { ok: false, message: `${meta.entity}当前状态「${current}」来源不明，已按「${meta.lifecycle[0]}」兼容，请重试` }
    }
    if (nextStep !== step + 1) {
      if (step === meta.lifecycle.length - 1) {
        return { ok: false, message: `${meta.entity}已是终态「${current}」，${meta.lifecycle[0] === '在册' ? '历史核销结论' : '结论'}保持不变` }
      }
      if (nextStep <= step) {
        return { ok: false, message: `${meta.entity}状态只能单向推进，不能从「${current}」回到「${target}」` }
      }
      const expected = meta.actions[step] ? meta.actionTargets[meta.actions[step]] : current
      return { ok: false, message: `${meta.entity}当前为「${current}」，需先推进到「${expected}」后才能${action}` }
    }
  } else if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 在快照上准备整笔事务：本模块状态 + 关联模块待办一起改，要么整体生效要么整体不动。
  const store = allRows()
  const nextStore = { ...store, [key]: [...rows] }
  nextStore[key][index] = {
    ...rows[index],
    status: target,
    pending: derivePending({ ...rows[index], status: target }, meta),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }

  if (meta.lifecycle && meta.crossLinks) {
    for (const link of meta.crossLinks) {
      if (link.action !== action) {
        continue
      }
      const linkedRows = store[link.module] ?? []
      // 关联键取源记录（不是目标表全量），并发时只有这条隐患点的关联待办会被清
      const linkedKey = String(rows[index][link.matchField] ?? '')
      let touched = false
      const nextLinkedRows = linkedRows.map((row) => {
        if (String(row[link.matchField] ?? '') !== linkedKey) {
          return row
        }
        if (!row.pending) {
          return row
        }
        touched = true
        return { ...row, pending: false }
      })
      if (touched) {
        nextStore[link.module] = nextLinkedRows
      }
    }
  }

  try {
    commitStore(nextStore)
  } catch {
    // 持久化失败：缓存已回滚，状态与关联待办都维持操作前的样子，不会只清掉一半待办
    return { ok: false, message: `${meta.entity}${action}失败，状态与关联待办已整体回滚，请重试` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
