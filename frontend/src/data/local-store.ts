import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, ModuleMeta } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 非状态机模块沿用旧规则：到了状态表末位就不再产生待办。
function derivePending(row: EntryRow, meta: ModuleMeta): boolean {
  const flow = meta.lifecycle ?? meta.statuses
  return String(row.status) !== flow[flow.length - 1]
}

// 兼容旧记录：状态只能在登记的状态机里认；遗留状态按映射归位；
// 缺状态来源的旧记录（含空值、未知状态）统一按首个状态（隐患点即「在册」）兼容。
function canonicalStatus(status: unknown, meta: ModuleMeta): string | null {
  const flow = meta.lifecycle ?? meta.statuses
  const raw = String(status ?? '').trim()
  if (raw && flow.includes(raw)) {
    return raw
  }
  if (raw && meta.legacyStatuses && meta.legacyStatuses[raw]) {
    return meta.legacyStatuses[raw]
  }
  return raw ? null : flow[0]
}

// 归一化单条记录，返回该条是否与原数据存在差异（用于把迁移结果落盘）。
function normalizeRow(row: EntryRow, meta: ModuleMeta): { row: EntryRow; dirty: boolean } {
  let dirty = false
  const next: EntryRow = { ...row }

  if (!meta.lifecycle) {
    // 普通模块：只兜底缺失状态，不改动历史上已写下的结论
    if (String(next.status ?? '').trim() === '') {
      next.status = meta.statuses[0]
      dirty = true
    }
  } else {
    const status = canonicalStatus(next.status, meta)
    if (status === null) {
      // 缺状态来源的旧记录按在册（首个状态）兼容
      next.status = meta.lifecycle[0]
      dirty = true
    } else if (status !== String(next.status)) {
      next.status = status
      dirty = true
    }
  }

  if (meta.lifecycle) {
    // 状态机模块的待办是状态的派生值：历史上写错的 pending（如已核销仍有待办）按状态纠正
    const pending = derivePending(next, meta)
    if (next.pending !== pending) {
      next.pending = pending
      dirty = true
    }
  } else if (typeof next.pending !== 'boolean') {
    next.pending = derivePending(next, meta)
    dirty = true
  }
  if (typeof next.abnormal !== 'boolean') {
    next.abnormal = false
    dirty = true
  }
  return { row: next, dirty }
}

// 已到终态的源记录（如已核销隐患点）关联的跨模块待办必须是清掉的；
// 历史半成品数据（只清了一半待办）在这里自愈，保证核销结论不被旧待办架空。
function healCrossLinks(store: Record<string, EntryRow[]>): boolean {
  let dirty = false
  for (const meta of MODULE_BY_KEY.values()) {
    if (!meta.lifecycle || !meta.crossLinks) {
      continue
    }
    const terminal = meta.lifecycle[meta.lifecycle.length - 1]
    const sourceRows = store[meta.key] ?? []
    for (const link of meta.crossLinks) {
      if (link.action !== meta.actions[meta.actions.length - 1]) {
        // 只对推进到终态的动作联动，避免误伤中间态
        continue
      }
      const linkedKeys = new Set(
        sourceRows
          .filter((row) => String(row.status) === terminal)
          .map((row) => String(row[link.matchField] ?? '')),
      )
      const linkedRows = store[link.module] ?? []
      for (const row of linkedRows) {
        if (linkedKeys.has(String(row[link.matchField] ?? '')) && row.pending) {
          row.pending = false
          dirty = true
        }
      }
    }
  }
  return dirty
}

function normalizeStore(raw: Record<string, EntryRow[]>): {
  store: Record<string, EntryRow[]>
  dirty: boolean
} {
  const store: Record<string, EntryRow[]> = {}
  let dirty = false
  for (const meta of MODULE_BY_KEY.values()) {
    const rows = raw[meta.key] ?? []
    const normalized = rows.map((row) => {
      const result = normalizeRow(row, meta)
      if (result.dirty) {
        dirty = true
      }
      return result.row
    })
    store[meta.key] = normalized
  }
  if (healCrossLinks(store)) {
    dirty = true
  }
  return { store, dirty }
}

function persistStore(store: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    // 整店一次写入：多模块联动只产生一次持久化，不会留下写了一半的状态
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  let merged: Record<string, EntryRow[]>
  if (typeof window === 'undefined' || !window.localStorage) {
    merged = clone(SEED_ROWS)
  } else {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      merged = clone(SEED_ROWS)
    } else {
      try {
        const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
        // 新模块/示例数据更新要能补齐，旧记录仍以浏览器里的为准
        merged = { ...clone(SEED_ROWS), ...parsed }
      } catch {
        merged = clone(SEED_ROWS)
      }
    }
  }

  const { store, dirty } = normalizeStore(merged)
  if (dirty) {
    // 旧数据完成迁移后立即落盘，避免每次进来都在「在册/监测中」之间反复
    persistStore(store)
  }
  return store
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitStore({ ...allRows(), [key]: rows })
}

// 事务提交入口：先整体落盘，落盘成功后才更新内存缓存。
// 任一步失败都抛出，调用方据此整体回滚，缓存与浏览器里的数据保持原状。
export function commitStore(next: Record<string, EntryRow[]>): void {
  const snapshot = allRows()
  try {
    persistStore(next)
    cache = next
  } catch (error) {
    cache = snapshot
    throw error
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
