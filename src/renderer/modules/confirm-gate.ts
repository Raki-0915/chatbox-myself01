/**
 * Chatbox Mod 模块 —— 自动更新「写回前确认门」（纯函数，无 UI 依赖，可单测）
 *
 * 核心目标：只要用户开启「需要确认」，写回前必须经过用户确认弹窗；
 * 弹窗缺失或异常时**必须中止**，绝不静默写回设定。
 */
import type { AutoUpdateDiff } from './types'

export type ConfirmGateResult =
  | { ok: true; diff: AutoUpdateDiff }
  | { ok: false; error: string }

export interface ConfirmGateOpts {
  onPreview?: (diff: AutoUpdateDiff) => Promise<AutoUpdateDiff | null>
  onConfirm?: () => Promise<boolean>
}

/**
 * 确认门：
 * 1. requireConfirm=false → 直接放行（用户明确选择不确认）
 * 2. 有 onPreview（逐条预览弹窗）→ 用户勾选后返回过滤 diff；取消（null）→ 中止
 * 3. 有 onConfirm（旧式布尔确认）→ 确认后放行；拒绝 → 中止
 * 4. onPreview 抛异常 → 中止（弹窗故障也不能静默写回）
 * 5. 两者都没有 → 中止（要求确认却没有确认通道，fail-safe）
 */
export async function runConfirmGate(
  requireConfirm: boolean,
  opts: ConfirmGateOpts,
  diff: AutoUpdateDiff
): Promise<ConfirmGateResult> {
  if (!requireConfirm) return { ok: true, diff }

  if (opts.onPreview) {
    let picked: AutoUpdateDiff | null
    try {
      picked = await opts.onPreview(diff)
    } catch (e) {
      return { ok: false, error: `更新预览弹窗异常，已中止更新（防止静默改写设定）：${String((e as Error)?.message ?? e)}` }
    }
    if (!picked) return { ok: false, error: '已取消' }
    return { ok: true, diff: picked }
  }

  if (opts.onConfirm) {
    const confirmed = await opts.onConfirm()
    if (!confirmed) return { ok: false, error: '已取消' }
    return { ok: true, diff }
  }

  return { ok: false, error: '自动更新已开启「需要确认」，但缺少确认弹窗通道，已中止（防止静默改写设定）' }
}
