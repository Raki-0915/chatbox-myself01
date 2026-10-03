/**
 * Chatbox Mod 模块 —— 世界书匹配（纯函数，无运行时依赖，可独立单测）
 *
 * 触发规则：
 * - always：始终注入
 * - keyword：对话文本包含任一关键词（子串匹配）
 * - regex：对话文本命中正则（大小写不敏感；非法正则回退为关键词包含匹配）
 */
import type { WorldBookEntry } from './types'

/** 匹配单个世界书条目（dt 为已小写化的对话文本） */
export function matchWorldBookEntry(x: WorldBookEntry, dt: string): boolean {
  if (!x.triggerMode || x.triggerMode === 'always') return true
  if (x.triggerMode === 'regex') {
    const p = Array.isArray(x.keywords) ? String(x.keywords[0] ?? '') : ''
    if (!p) return false
    try {
      return new RegExp(p, 'i').test(dt)
    } catch {
      // 非法正则：回退为该条目关键词包含匹配，避免条目静默失效
      return (x.keywords ?? []).some((k) => String(k).toLowerCase() && dt.includes(String(k).toLowerCase()))
    }
  }
  const kws = Array.isArray(x.keywords) ? x.keywords.map((k) => String(k).toLowerCase()).filter(Boolean) : []
  return kws.some((k) => dt.includes(k))
}

/** 世界书内容 → 注入段落（关键词/正则/始终触发 + order 排序） */
export function buildWorldBookSection(entries: WorldBookEntry[], dialogText: string, limit: number): string {
  const dt = String(dialogText ?? '').toLowerCase()
  const hit = entries
    .filter((x) => x && x.enabled !== false && (x.content ?? '').trim())
    .filter((x) => matchWorldBookEntry(x, dt))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  if (hit.length === 0) return ''
  const body = hit.map((x) => `### ${x.name}\n${x.content.trim()}`).join('\n\n')
  const sliced = body.slice(0, limit)
  return sliced ? `## World Book\n${sliced}` : ''
}
