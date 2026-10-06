import type { EntryRow } from './types'
import { listRows } from './local-store'

// 跨模块联动：一个模块状态推进后，关联模块要跟着闭环的待办都在这里声明。
// 联动只允许「关闭/推进」待办，绝不反向改动主动作的状态；联动结果随主动作一起提交。

export type RelatedPatch = {
  moduleKey: string
  rows: EntryRow[]
  note: string
}

// 巡查记录通过「隐患点编号」与隐患点关联。隐患点退出监测后，
// 指向它的「待巡查」待办不再成立，统一关闭到「已处置」闭环。
const PATROL_PENDING_STATUS = '待巡查'
const PATROL_CLOSED_STATUS = '已处置'

function matchHazardCode(hazardRow: EntryRow, related: EntryRow): boolean {
  const code = String(hazardRow['隐患点编号'] ?? '').trim()
  if (!code) {
    return false
  }
  return String(related['隐患点编号'] ?? '').trim() === code
}

function closePendingPatrol(hazardRow: EntryRow): RelatedPatch | null {
  const rows = listRows('patrol')
  let changed = false
  const next = rows.map((row) => {
    if (!matchHazardCode(hazardRow, row)) {
      return row
    }
    if (String(row.status ?? '').trim() !== PATROL_PENDING_STATUS) {
      return row
    }
    changed = true
    return { ...row, status: PATROL_CLOSED_STATUS, pending: false }
  })
  if (!changed) {
    return null
  }
  return {
    moduleKey: 'patrol',
    rows: next,
    note: `关联隐患点 ${hazardRow['隐患点编号']} 已退出监测，待巡查待办同步闭环`,
  }
}

// 隐患点推进到某目标态后需要触发的联动。
// 已治理、已核销都意味着该点不再需要巡查待办；已核销是终态闭环。
export function hazardSideEffects(targetStatus: string, hazardRow: EntryRow): RelatedPatch[] {
  if (targetStatus !== '已治理' && targetStatus !== '已核销') {
    return []
  }
  const patch = closePendingPatrol(hazardRow)
  return patch ? [patch] : []
}
