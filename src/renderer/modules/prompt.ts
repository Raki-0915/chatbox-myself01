/**
 * Chatbox Mod 模块 —— 提示词注入
 *
 * 把已装载的世界书/人物卡按触发规则拼成系统提示词段落。
 * 注入位置：agent-harness 组装 instructions 时（见 agent-harness.ts 的改动）。
 */
import { getDefaultStore } from 'jotai'
import { characterCardsAtom, modSettingsAtom, worldBooksAtom } from './store'
import type { CharacterCard, WorldBookEntry } from './types'

/** 读取目标会话装载的条目（enabled 且 id 命中） */
function getEnabledByIds<T extends { id: string; enabled?: boolean }>(all: T[], ids: string[]): T[] {
  return all.filter((x) => x && x.enabled !== false && ids.includes(x.id))
}

/** 世界书匹配（纯函数）：always/regex/keyword 触发与段落组装，实现在 worldbook-match.ts（可独立单测） */
import { buildWorldBookSection } from './worldbook-match'

/** 人物卡内容 → 注入段落（格式化 RPG 字段） */
export function buildCharacterCardSection(cards: CharacterCard[], dialogText: string, limit: number): string {
  const dt = String(dialogText ?? '').toLowerCase()
  const hit = cards.filter((c) => c && c.enabled !== false && (c.name ?? '').trim()).filter((c) => {
    // 关键词模式：人物卡按 backgroundStory/性格等命中关键词
    const kw = String(
      [c.backgroundStory, c.personalityType, c.occupation, ...(c.customAttributes ?? []).map((a) => `${a.key}:${a.value}`)].join(' ')
    ).toLowerCase()
    if (!kw) return true
    return dt ? true : true // 人物卡默认始终注入（与原版行为一致）
  })
  if (hit.length === 0) return ''
  const body = hit
    .map((c) => {
      const parts = [`【${c.name}】`]
      if (c.age) parts.push(`年龄:${c.age}`)
      if (c.gender) parts.push(`性别:${c.gender}`)
      if (c.occupation) parts.push(`职业:${c.occupation}`)
      if (c.appearance) parts.push(`外貌:${c.appearance}`)
      if (c.personalityType) parts.push(`性格:${c.personalityType}`)
      if (c.strengths) parts.push(`优点:${c.strengths}`)
      if (c.weaknesses) parts.push(`缺点:${c.weaknesses}`)
      if (c.hobbies) parts.push(`爱好:${c.hobbies}`)
      if (c.backgroundStory) parts.push(`背景:${c.backgroundStory}`)
      if (Array.isArray(c.relationships) && c.relationships.length > 0) {
        parts.push(`关系:${c.relationships.map((r) => `${r.targetName}:${r.relation}${r.description ? `(${r.description})` : ''}`).join(';')}`)
      }
      return parts.join(' | ')
    })
    .join('\n')
  const sliced = body.slice(0, limit)
  return sliced ? `## Character Cards\n${sliced}` : ''
}

/**
 * 构建世界书+人物卡注入段落（供 agent-harness 调用）。
 * 返回拼接好的段落（人物卡在前，世界书在后，与原版 v48 顺序一致）。
 */
export async function buildWorldInjection(worldBookIds: string[], characterCardIds: string[], dialogText: string): Promise<string> {
  try {
    const store = getDefaultStore()
    const settings = store.get(modSettingsAtom)
    const allWb = store.get(worldBooksAtom)
    const allCc = store.get(characterCardsAtom)
    const wb = getEnabledByIds(allWb, worldBookIds ?? [])
    const cc = getEnabledByIds(allCc, characterCardIds ?? [])
    const ccSection = buildCharacterCardSection(cc, dialogText, settings.ccInjectionLimit)
    const wbSection = buildWorldBookSection(wb, dialogText, settings.wbInjectionLimit)
    const parts = [ccSection, wbSection].filter(Boolean)
    return parts.length ? parts.join('\n\n') : ''
  } catch {
    return ''
  }
}
