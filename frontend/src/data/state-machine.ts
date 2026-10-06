import type { ModuleMeta } from './types'

// 状态机：集中描述每个模块「合法流转」。只有登记在这里的 (当前状态 -> 动作) 才允许执行。
// 设计目标：状态只能单向推进，不允许跳跃、回退；未登记的旧状态先归一化兼容，再参与流转。

export type TransitionRule = {
  // 动作执行时记录必须处于的前置状态；缺来源的旧记录先经 normalizeStatus 归一化
  from: string
  // 动作推进到的目标状态，必须是 flow 中 from 之后的环节
  to: string
}

export type StateFlow = {
  // 单向推进的主链路，下标即推进次序，禁止回退
  flow: string[]
  // 历史上出现过、但不属于主链路的状态：读取时归一化到 alias 指向的主链路状态
  legacyAliases?: Record<string, string>
  // 动作 -> 前置状态/目标状态；未登记的动作一律拒绝
  transitions: Record<string, TransitionRule>
}

// 隐患点：在册 -> 监测中 -> 已治理 -> 已核销，严格单向、逐环推进。
// 「新增」是历史遗留状态，没有独立业务含义，缺来源的旧记录统一按在册兼容。
const HAZARD_FLOW: StateFlow = {
  flow: ['在册', '监测中', '已治理', '已核销'],
  legacyAliases: { 新增: '在册' },
  transitions: {
    纳入监测: { from: '在册', to: '监测中' },
    启动治理: { from: '监测中', to: '已治理' },
    申请核销: { from: '已治理', to: '已核销' },
  },
}

const FLOW_BY_MODULE_KEY: Record<string, StateFlow> = {
  hazard: HAZARD_FLOW,
}

export function stateFlowOf(meta: ModuleMeta): StateFlow | null {
  return FLOW_BY_MODULE_KEY[meta.key] ?? null
}

// 缺状态来源的旧记录按模块兼容策略归一化：命中历史别名就映射，
// 既不在主链路也没有别名的，兜底为链路起点（隐患点即「在册」）。
export function normalizeStatus(meta: ModuleMeta, rawStatus: unknown): string {
  const flow = stateFlowOf(meta)
  const status = String(rawStatus ?? '').trim()
  if (!flow) {
    return status || meta.statuses[0]
  }
  if (flow.flow.includes(status)) {
    return status
  }
  const aliased = flow.legacyAliases?.[status]
  if (aliased && flow.flow.includes(aliased)) {
    return aliased
  }
  return flow.flow[0]
}

// 终态：主链路最后一个环节。到达终态后不再产生待办，也不允许任何后续动作。
export function terminalStatus(meta: ModuleMeta): string {
  const flow = stateFlowOf(meta)
  return flow ? flow.flow[flow.flow.length - 1] : meta.statuses[meta.statuses.length - 1]
}

// 待办完全由状态派生：只有非终态记录才算待处理，杜绝标志位与状态脱节。
export function isPendingStatus(meta: ModuleMeta, status: string): boolean {
  return normalizeStatus(meta, status) !== terminalStatus(meta)
}

export type TransitionCheck =
  | { ok: true; from: string; to: string }
  | { ok: false; message: string }

// 校验一次动作：先归一化当前状态，再核对前置环节与推进方向。
export function checkTransition(meta: ModuleMeta, rawStatus: unknown, action: string): TransitionCheck {
  const flow = stateFlowOf(meta)
  const current = normalizeStatus(meta, rawStatus)
  if (!flow) {
    // 未接入状态机的模块保持原有「直达目标态」行为
    return { ok: true, from: current, to: current }
  }
  const rule = flow.transitions[action]
  if (!rule) {
    return { ok: false, message: `${meta.entity}当前不允许执行「${action}」` }
  }
  if (current === rule.to) {
    return { ok: false, message: `${meta.entity}已经是「${rule.to}」，不用重复操作` }
  }
  if (current !== rule.from) {
    const fromIndex = flow.flow.indexOf(rule.from)
    const currentIndex = flow.flow.indexOf(current)
    if (currentIndex >= 0 && currentIndex > fromIndex) {
      return {
        ok: false,
        message: `${meta.entity}已推进到「${current}」，不能再${action}回「${rule.to}」`,
      }
    }
    return {
      ok: false,
      message: `${meta.entity}当前为「${current}」，需先处于「${rule.from}」才能${action}`,
    }
  }
  return { ok: true, from: current, to: rule.to }
}
