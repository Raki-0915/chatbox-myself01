/**
 * Chatbox Mod 模块 —— 角色知识库事件去重合并（纯函数，无 UI / 无外部依赖）
 *
 * 方案书：任务方案书_角色知识库事件去重合并_202610052157.md
 * A 自动判重（源头防重复）→ B 合并追加（相似聚合）→ C 预览人工确认（用户兜底）。
 *
 * 相似度 = 内容 bigram Dice（0.7 权重）+ 触发词 Jaccard 重合（0.3 权重），0~1。
 * 敏感度三档（skip = 自动跳过阈值，suspect = 疑似重复阈值）：
 *   strict   skip 0.8 / suspect 0.5
 *   standard skip 0.7 / suspect 0.4   （默认）
 *   loose    skip 0.6 / suspect 0.3
 */

import { similarityRatio } from './text-similarity'
import type { AutoUpdateDiff } from './types'

export type EventDedupSensitivity = 'strict' | 'standard' | 'loose'

export const EVENT_SENSITIVITY: Record<EventDedupSensitivity, { skip: number; suspect: number }> = {
  strict: { skip: 0.8, suspect: 0.5 },
  standard: { skip: 0.7, suspect: 0.4 },
  loose: { skip: 0.6, suspect: 0.3 },
}

export const DEFAULT_EVENT_SENSITIVITY: EventDedupSensitivity = 'standard'

/** 合并上限：单条事件累计超过该字符数后不再合并，改为新增（方案书 3.3 / 风险表） */
export const EVENT_MERGE_LIMIT = 3000

/** 事件判重输入（diff.events.append 项） */
export interface DedupEventItem {
  roleName?: string
  name?: string
  content?: string
  keywords?: unknown
}

export interface DedupTarget {
  id: string
  roleName?: string
  content: string
  keywords?: string[]
  frozen?: boolean
}

export interface DedupResult {
  /** 明确新增（< suspect） */
  add: DedupEventItem[]
  /** 疑似重复（suspect ~ skip）：进预览，由用户选 跳过/合并/仍新增 */
  suspect: Array<{ item: DedupEventItem; targetId: string; score: number }>
  /** 明确重复（≥ skip）：自动跳过，记日志可恢复 */
  skip: Array<{ item: DedupEventItem; targetId: string; score: number }>
}

/** 规范化（去空白、小写） */
function norm(s: string): string {
  return String(s ?? '').replace(/\s+/g, '').trim().toLowerCase()
}

/** 关键词重合率：Jaccard（交集 / 并集），空关键词双方 → 0（不贡献相似） */
function keywordOverlap(a: string[], b: string[]): number {
  const A = (a ?? []).map(norm).filter(Boolean)
  const B = (b ?? []).map(norm).filter(Boolean)
  if (A.length === 0 || B.length === 0) return 0
  const setA = new Set(A)
  const inter = B.filter((k) => setA.has(k)).length
  const union = new Set([...A, ...B]).size
  return union === 0 ? 0 : inter / union
}

/** 事件相似度（0~1）：内容 Dice 0.7 + 触发词重合 0.3；内容为空 → 0 */
export function eventSimilarity(a: string, aKws: string[] | undefined, b: string, bKws: string[] | undefined): number {
  const ca = norm(a)
  const cb = norm(b)
  if (!ca || !cb) return 0
  const contentSim = similarityRatio(ca, cb)
  const kwSim = keywordOverlap(aKws ?? [], bKws ?? [])
  return Math.round((contentSim * 0.7 + kwSim * 0.3) * 100) / 100
}

/** 按敏感度档位判定相似度去向 */
export function classifyDedup(score: number, sensitivity: EventDedupSensitivity): 'skip' | 'suspect' | 'add' {
  const { skip, suspect } = EVENT_SENSITIVITY[sensitivity] ?? EVENT_SENSITIVITY[DEFAULT_EVENT_SENSITIVITY]
  if (score >= skip) return 'skip'
  if (score >= suspect) return 'suspect'
  return 'add'
}

/**
 * 对角色已有事件做去重分流：
 * - 冻结事件（frozen=true）只作判重参照，绝不作为合并目标；
 * - 已超合并上限的目标不可合并（命中时降级为新增）；
 * - 每个新事件与所有已有事件比对取最高分。
 */
export function planEventDedup(
  existing: DedupTarget[],
  newItems: DedupEventItem[],
  sensitivity: EventDedupSensitivity = DEFAULT_EVENT_SENSITIVITY
): DedupResult {
  const result: DedupResult = { add: [], suspect: [], skip: [] }
  for (const item of newItems) {
    const content = String(item.content ?? '').trim()
    if (!content) continue
    const kws = Array.isArray(item.keywords) ? item.keywords.map((k) => String(k).trim()).filter(Boolean) : []
    let best: { target: DedupTarget; score: number } | null = null
    for (const t of existing) {
      const s = eventSimilarity(content, kws, t.content, t.keywords)
      if (!best || s > best.score) best = { target: t, score: s }
    }
    if (!best) {
      result.add.push(item)
      continue
    }
    const cls = classifyDedup(best.score, sensitivity)
    if (cls === 'skip') {
      result.skip.push({ item, targetId: best.target.id, score: best.score })
    } else if (cls === 'suspect') {
      // 疑似重复：若最佳匹配目标是冻结事件或已超合并上限 → 无法合并，只能跳过/新增
      // （预览中"合并"不可用时自动降级为"仍新增"之外的默认"跳过"由用户决定）
      result.suspect.push({ item, targetId: best.target.id, score: best.score })
    } else {
      result.add.push(item)
    }
  }
  return result
}

/** 目标事件是否可合并（方案书 3.3：冻结事件禁止合并；合并上限保护） */
export function canMerge(target: DedupTarget): boolean {
  if (target.frozen) return false
  if (norm(target.content).length > EVENT_MERGE_LIMIT) return false
  return true
}

/**
 * 合并：新事件细节追加到原条目末尾（只增不覆盖），触发词并集去重，时间戳更新。
 * - 内容追加：若新内容已包含在原内容中则不重复追加；
 * - 返回合并后的新事件对象（保留原 id）。
 */
export function mergeEvent(target: DedupTarget, item: DedupEventItem, t = Date.now()): { id: string; roleName: string; content: string; keywords: string[]; t: number; frozen?: boolean } {
  const oldContent = String(target.content ?? '').trim()
  const newContent = String(item.content ?? '').trim()
  const normOld = norm(oldContent)
  const normNew = norm(newContent)
  let content = oldContent
  if (normNew && !normOld.includes(normNew)) {
    content = oldContent ? `${oldContent}\n${newContent}` : newContent
  }
  const kws = [...new Set([...(target.keywords ?? []), ...(Array.isArray(item.keywords) ? item.keywords.map((k) => String(k).trim()).filter(Boolean) : [])])].slice(0, 8)
  return {
    id: target.id,
    roleName: String(target.roleName ?? item.roleName ?? item.name ?? '').trim(),
    content,
    keywords: kws,
    t,
    frozen: target.frozen,
  }
}

/**
 * 对自动更新 diff 的 events.append 做去重分流（方案书 3.1）：
 * - 明确重复（≥skip）→ 移入 diff.events.skip（自动跳过，预览可展开/一键恢复）
 * - 疑似重复（suspect）→ hasPreview 时留在 append 并带 {score, targetId} 元数据（预览橙标+3操作）；
 *   自动模式（无预览）→ 移入 skip（保守跳过并计数）
 * - 新增 → 留在 append（无标记）
 * 无归属角色卡的项原样保留（应用层自行跳过，保持与现状一致）。
 */
export function dedupDiffEvents(
  diff: AutoUpdateDiff,
  ccByName: Map<string, { associatedEvents?: Array<{ id: string; content: string; keywords?: string[]; frozen?: boolean }> }>,
  sensitivity: EventDedupSensitivity = DEFAULT_EVENT_SENSITIVITY,
  hasPreview = true
): AutoUpdateDiff {
  const append = diff.events?.append ?? []
  if (append.length === 0) return diff
  const skip: Array<{ item: Record<string, unknown>; targetId: string; score: number }> = []
  const nextAppend: Array<Record<string, unknown>> = []
  for (const item of append) {
    const roleName = String(item.roleName ?? item.name ?? '').trim()
    const card = roleName ? ccByName.get(roleName) : undefined
    if (!card) {
      nextAppend.push(item)
      continue
    }
    const existing = (card.associatedEvents ?? []).map((e) => ({
      id: e.id,
      content: e.content,
      keywords: e.keywords,
      frozen: e.frozen,
    }))
    const plan = planEventDedup(existing, [item], sensitivity)
    if (plan.skip.length > 0) {
      skip.push({ item, targetId: plan.skip[0].targetId, score: plan.skip[0].score })
      continue
    }
    if (plan.suspect.length > 0) {
      const s = plan.suspect[0]
      if (hasPreview) {
        nextAppend.push({ ...item, _dedup: { score: s.score, targetId: s.targetId } })
      } else {
        skip.push({ item, targetId: s.targetId, score: s.score })
      }
      continue
    }
    nextAppend.push(item)
  }
  return { ...diff, events: { append: nextAppend, skip: skip.length > 0 ? skip : diff.events?.skip ?? [] } }
}
