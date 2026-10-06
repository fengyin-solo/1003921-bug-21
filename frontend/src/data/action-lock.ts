// 动作串行锁：runAction 包含「读状态 → 校验 → 跨模块联动 → 落盘」多个环节。
// 虽然 JS 单线程，但 await/重入调用之间仍可能交错，这里把每次动作整体排队，
// 保证治理与核销并发提交时，前一个完整结束（含联动落盘）后下一个才开始，
// 后一个会读到最新状态并被状态机拒绝，从而只有一个动作成功。
let chain: Promise<unknown> = Promise.resolve()

export function serialize<T>(task: () => T | Promise<T>): Promise<T> {
  const run = chain.then(() => task())
  // 单个任务失败不打断后续排队，只把失败结果返回给调用方。
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
