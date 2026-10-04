/**
 * Chatbox Mod 模块 —— 背景/事件分流核心（纯函数，可单测）
 *
 * 1. remove 保护：含冻结段/有关联事件的条目，自动更新一律不得删除
 * 2. 关联事件追加：剧情进展累积到对应人物卡事件区末尾（只增不改，上限截断最旧）
 * 3. 事件注入段落：对话命中事件关键词才按需注入（不占常驻上下文）
 */
import { v4 as uuidv4 } from 'uuid'
import type { AssociatedEvent, AutoUpdateDiff, CharacterCard } from './types'

/** 每张人物卡关联事件上限（超出截断最旧，方案书风险表） */
export const MAX_EVENTS_PER_CARD = 200
/** 单次注入最多携带的事件条数（最近 N 条命中事件） */
export const MAX_EVENTS_INJECT = 30

/** 事件区上限截断：保留最近 max 条（只删最旧不删最新） */
export function capEvents(list: AssociatedEvent[], max = MAX_EVENTS_PER_CARD): AssociatedEvent[] {
  if (!Array.isArray(list) || list.length === 0) return []
  return list.length > max ? list.slice(list.length - max) : list
}

/**
 * remove 保护（写回前的最后防线，与确认门同层）：
 * - 世界书：含冻结段（frozenTexts 非空）的条目禁止删除
 * - 人物卡：含冻结段或有关联事件历史（associatedEvents 非空）的条目禁止删除
 * 过滤后的 remove 列表不再展示/执行。
 */
export function applyRemoveGuard(
  diff: AutoUpdateDiff,
  wbProtected: (name: string) => boolean,
  ccProtected: (name: string) => boolean
): AutoUpdateDiff {
  return {
    ...diff,
    wb: { ...diff.wb, remove: diff.wb.remove.filter((n) => !wbProtected(n)) },
    cc: { ...diff.cc, remove: diff.cc.remove.filter((n) => !ccProtected(n)) },
  }
}

/**
 * 关联事件追加：剧情事件累积到对应人物卡事件区**末尾**（只增不改，旧事件原样保留）。
 * 归属角色必须等于卡片 name；内容为空/归属不符的事件跳过。
 */
export function appendEvents(
  card: CharacterCard,
  items: Array<{ roleName?: string; content?: string; keywords?: unknown }>,
  t = Date.now()
): CharacterCard {
  const list = Array.isArray(card.associatedEvents) ? card.associatedEvents : []
  const next = [...list]
  for (const it of items) {
    const content = String(it.content ?? '').trim()
    if (!content) continue
    const roleName = String(it.roleName ?? '').trim() || card.name
    if (roleName !== card.name) continue // 本卡事件只归属本卡角色
    const kws = Array.isArray(it.keywords)
      ? it.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 8)
      : []
    next.push({ id: uuidv4(), roleName: card.name, content, keywords: kws, t })
  }
  return { ...card, associatedEvents: capEvents(next) }
}

/**
 * 事件注入段落：对话命中事件关键词才注入（按需注入，不占常驻上下文）。
 * 冻结的事件同样注入（冻结=不改写，不影响展示）；无关键词事件不常驻注入。
 */
export function buildAssociatedEventSection(cards: CharacterCard[], dialogText: string, budget: number): string {
  const dt = String(dialogText ?? '').toLowerCase()
  const rows: string[] = []
  for (const c of cards) {
    if (!c || !c.name) continue
    const list = (c.associatedEvents ?? []).filter((e) => e && String(e.content ?? '').trim())
    if (list.length === 0) continue
    const hit = list.filter((e) => (e.keywords ?? []).some((k) => k && dt.includes(String(k).toLowerCase())))
    if (hit.length === 0) continue
    const body = hit
      .slice(-MAX_EVENTS_INJECT)
      .map((e) => `- ${e.content}${e.keywords && e.keywords.length ? `（触发词: ${e.keywords.join('/')}）` : ''}`)
      .join('\n')
    rows.push(`## 关联事件 · ${c.name}\n${body}`)
  }
  const joined = rows.join('\n\n')
  return joined ? joined.slice(0, Math.max(0, budget)) : ''
}
