import { MODULE_BY_KEY } from '@/data/modules'
import { serialize } from '@/data/action-lock'
import { allRows, commit, listRows, resetRows } from '@/data/local-store'
import { hazardSideEffects } from '@/data/side-effects'
import {
  checkTransition,
  isPendingStatus,
  normalizeStatus,
  terminalStatus,
} from '@/data/state-machine'
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
  // 读出来先做状态归一化：缺状态来源的旧记录按在册兼容，历史别名就地纠正，列表与详情同源。
  const rows = normalizeRows(key, listRows(key))
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 读取侧归一化：不回写存储，只保证任何入口（列表/详情/看板）看到的状态一致。
function normalizeRows(key: string, rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return rows
  }
  return rows.map((row) => {
    // 所有模块统一：状态归一化 + 待办由状态派生，避免旧标志位与状态脱节。
    const status = normalizeStatus(meta, row.status)
    const pending = isPendingStatus(meta, status)
    // 隐患点业务字段「隐患状态」历史上与流转状态脱节，读取时统一对齐到同一来源。
    const businessMismatch = meta.key === 'hazard' && String(row['隐患状态'] ?? '') !== status
    if (status === String(row.status) && pending === row.pending && !businessMismatch) {
      return row
    }
    const next: EntryRow = { ...row, status, pending }
    if (businessMismatch) {
      next['隐患状态'] = status
    }
    return next
  })
}

export function runAction(key: string, id: number, action: string): Promise<ActionResult> {
  const meta = moduleMeta(key)
  // 乐观并发：在调用发起的这一刻捕获记录状态作为「期望前置态」。
  // 进入串行队列后若状态已被并发动作改写，就判定本次动作过期并拒绝，
  // 从而「治理 / 核销」基于同一状态并发提交时只有一个能成功。
  const baseRows = listRows(key)
  const baseRow = baseRows.find((row) => Number(row.id) === id)
  const expectedStatus = baseRow ? normalizeStatus(meta, baseRow.status) : null
  return serialize(() => runActionLocked(key, id, action, expectedStatus))
}

function runActionLocked(
  key: string,
  id: number,
  action: string,
  expectedStatus: string | null,
): ActionResult {
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

  // 并发保护：排队期间状态若已被另一个动作推进，本次动作整体放弃，不做任何写入。
  const currentStatus = normalizeStatus(meta, rows[index].status)
  if (expectedStatus !== null && currentStatus !== expectedStatus) {
    return {
      ok: false,
      message: `${meta.entity}状态已被其他操作推进到「${currentStatus}」，本次「${action}」未执行`,
    }
  }

  // 状态机校验：归一化当前状态后，只允许沿主链路单向推进一步。
  // 「启动治理」和「申请核销」前置环节不同，并发/连点时只有一个能通过校验。
  const check = checkTransition(meta, rows[index].status, action)
  if (!check.ok) {
    return { ok: false, message: check.message }
  }
  const nextStatus = check.to

  // 待办由状态派生：终态不再有待办；异常标记只由「往回走」类动作产生（单向流转不会命中）。
  const updated: EntryRow = {
    ...rows[index],
    status: nextStatus,
    pending: isPendingStatus(meta, nextStatus),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 隐患点台账里业务字段「隐患状态」与流转状态保持同源，避免列表/详情各显示一个状态。
  if (meta.key === 'hazard') {
    updated['隐患状态'] = nextStatus
  }

  // 主动作 + 跨模块联动在同一事务内提交：联动失败则整体不写入，不会只清一半待办。
  const nextRows = [...rows]
  nextRows[index] = updated
  const patches = { [key]: nextRows }
  if (meta.key === 'hazard') {
    for (const side of hazardSideEffects(nextStatus, updated)) {
      patches[side.moduleKey] = side.rows
    }
  }
  try {
    commit(patches)
  } catch {
    return { ok: false, message: `${meta.entity}状态更新失败，已整体回滚，请重试` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${nextStatus}」` }
}

// 详情与列表走同一份归一化数据，保证「列表、详情、重新进入」三处状态一致。
export function getEntry(key: string, id: number): EntryRow | null {
  const rows = normalizeRows(key, listRows(key))
  return rows.find((row) => Number(row.id) === id) ?? null
}

export function terminalStatusOf(key: string): string {
  return terminalStatus(moduleMeta(key))
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
    const entries = normalizeRows(meta.key, rows[meta.key] ?? [])
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => isPendingStatus(meta, String(row.status))).length,
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
