/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type CrossLink = {
  // 在源模块上触发联动的动作（如隐患点「申请核销」）
  action: string
  // 被联动清理待办的模块（如巡查排查）
  module: string
  // 两侧用于关联的字段（如「隐患点编号」）
  matchField: string
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 单向推进的状态机：配置后动作只能逐级向前，末位为终态（终态记录不再产生待办）
  lifecycle?: string[]
  // 旧版本遗留状态到现状态的兼容映射；其余缺状态来源的旧记录统一按首个状态兼容
  legacyStatuses?: Record<string, string>
  // 源模块动作成功时需要同事务联动的跨模块待办
  crossLinks?: CrossLink[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
