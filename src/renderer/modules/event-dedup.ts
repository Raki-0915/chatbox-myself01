/**
 * Chatbox Mod 模块 —— 角色知识库事件合并能力（纯函数，无 UI / 无外部依赖）
 *
 * 方案书：任务方案书_角色知识库事件去重合并_202610052157.md（v2.2）
 * v2.2：删除自动判重（阈值/敏感度/拦截/跳过），自动更新分析出的事件全部直接追加；
 *       重复整理完全交给「手动合并」（D）。本模块只保留手动合并所需能力：
 *   - eventSimilarity：相似度计算（合并预览/提示用）
 *   - canMerge：目标是否可合并（冻结事件禁止、超限禁止）
 *   - mergeEvent / mergeEvents：合并执行（内容按序拼接去重、触发词并集、时间戳更新）
 *
 * 相似度 = 内容 bigram Dice（0.7 权重）+ 触发词 Jaccard 重合（0.3 权重），0~1。
 */

import { similarityRatio } from './text-similarity'

/** 合并上限：单条事件累计超过该字符数后不再合并，改为新增（方案书 3.3 / 风险表） */
export const EVENT_MERGE_LIMIT = 3000

/** 事件判重输入（手动合并的源条目） */
export interface DedupEventItem {
  id?: string
  roleName?: string
  name?: string
  content?: string
  keywords?: unknown
}

/** 合并目标事件 */
export interface DedupTarget {
  id: string
  roleName?: string
  content: string
  keywords?: string[]
  frozen?: boolean
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

/** 目标事件是否可合并（方案书 3.2：冻结事件禁止合并；合并上限保护） */
export function canMerge(target: DedupTarget): boolean {
  if (target.frozen) return false
  if (norm(target.content).length > EVENT_MERGE_LIMIT) return false
  return true
}

/**
 * 合并：按时间顺序把多条事件的细节拼接进目标条目（只增不覆盖），触发词并集去重，
 * 完全重复的句子自动去重，时间戳取最近一次。
 * @returns 合并后的新事件对象（保留目标 id）
 */
export function mergeEvents(
  target: DedupTarget,
  sources: DedupEventItem[],
  t = Date.now()
): { id: string; roleName: string; content: string; keywords: string[]; t: number; frozen?: boolean } {
  let content = String(target.content ?? '').trim()
  const normOld = norm(content)
  const kws = [...(target.keywords ?? [])]
  for (const item of sources) {
    const newContent = String(item.content ?? '').trim()
    const normNew = norm(newContent)
    if (normNew && !normOld.includes(normNew)) {
      content = content ? `${content}\n${newContent}` : newContent
    }
    if (Array.isArray(item.keywords)) {
      for (const k of item.keywords.map((x) => String(x).trim()).filter(Boolean)) {
        if (!kws.includes(k)) kws.push(k)
      }
    }
  }
  const last = sources.length > 0 ? sources[sources.length - 1] : undefined
  return {
    id: target.id,
    roleName: String(target.roleName ?? last?.roleName ?? last?.name ?? '').trim(),
    content,
    keywords: kws.slice(0, 8),
    t,
    frozen: target.frozen,
  }
}

/** 兼容旧调用：单条来源合并（保留原 mergeEvent 语义） */
export function mergeEvent(target: DedupTarget, item: DedupEventItem, t = Date.now()) {
  return mergeEvents(target, [item], t)
}
