/**
 * Chatbox Mod 模块 —— 提示词注入
 *
 * 把已装载的世界书/人物卡按触发规则拼成系统提示词段落。
 * 注入位置：agent-harness 组装 instructions 时（见 agent-harness.ts 的改动）。
 */
import { getDefaultStore } from 'jotai'
import { characterCardsAtom, modSettingsAtom, worldBooksAtom } from './store'
import type { CharacterCard, WorldBookEntry } from './types'
import { buildAssociatedEventSection } from './event-split'

/** 读取目标会话装载的条目（enabled 且 id 命中） */
function getEnabledByIds<T extends { id: string; enabled?: boolean }>(all: T[], ids: string[]): T[] {
  return all.filter((x) => x && x.enabled !== false && ids.includes(x.id))
}

/** 世界书匹配（纯函数）：always/regex/keyword 触发与段落组装，实现在 worldbook-match.ts（可独立单测） */
import { splitWorldBookSections, adaptiveInjectionBudget } from './worldbook-match'

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
 * 世界书采用分层注入（简化深度）：常驻段（always/depth0）在前，场景触发段（keyword/regex，depth>=1）按 depth/order 在后。
 */
export async function buildWorldInjection(worldBookIds: string[], characterCardIds: string[], dialogText: string): Promise<string> {
  try {
    const store = getDefaultStore()
    const settings = store.get(modSettingsAtom)
    const allWb = store.get(worldBooksAtom)
    const allCc = store.get(characterCardsAtom)
    const wb = getEnabledByIds(allWb, worldBookIds ?? [])
    const cc = getEnabledByIds(allCc, characterCardIds ?? [])
    const groupMode = settings.chatMode === 'group'
    if (groupMode) {
      // 群聊模板：在场角色名单（紧凑人设）+ 群聊规则（轮流发言 / 系统事件优先）
      const roster = cc
        .map((c) => {
          const bits = [`【${c.name}】`]
          if (c.personalityType) bits.push(`性格:${c.personalityType}`)
          if (c.occupation) bits.push(`职业:${c.occupation}`)
          if (c.backgroundStory) bits.push(`背景:${c.backgroundStory.slice(0, 200)}`)
          return bits.join(' | ')
        })
        .join('\n')
      const groupRules = [
        '## 群聊规则',
        '- 以下是在场角色（名单按优先级排序），你是这场群像剧的导演/旁白系统：',
        roster || '（当前无角色名单）',
        '- 每次回复以「在场角色轮流发言」的形式输出，格式为「角色名：台词」，一个角色一行；动作/描写可写在括号里。',
        '- 用户消息若标记为「系统事件」（消息名称为"系统"），表示剧情事件/环境变化，所有在场角色必须围绕该事件回应，不得忽略。',
        '- 用户未点名角色时，由与话题最相关的角色先开口，其他角色自然接话，一次回复覆盖在场角色。',
        '- 世界书设定依然有效；与角色人设冲突时以角色人设为准。',
      ].join('\n')
      const wbBudget = adaptiveInjectionBudget(settings.wbInjectionLimit, dialogText.length)
      const residentLimit = Math.min(Math.floor(wbBudget * 0.6), settings.wbInjectionLimit)
      const { resident, scene } = splitWorldBookSections(wb, dialogText, settings.wbInjectionLimit)
      const res = resident.slice(0, residentLimit)
      const sc = scene.slice(0, Math.max(0, wbBudget - res.length))
      const wbParts: string[] = []
      if (res) wbParts.push(`## World Book · 常驻设定\n${res}`)
      if (sc) wbParts.push(`## World Book · 场景触发\n${sc}`)
      const parts = [groupRules, wbParts.join('\n\n')].filter(Boolean)
      return parts.length ? parts.join('\n\n') : ''
    }
    // 注入体积自适应：对话越长预算越小（常驻优先，场景占剩余）
    const ccBudget = adaptiveInjectionBudget(settings.ccInjectionLimit, dialogText.length)
    // 背景区（人设稳定内容）与关联事件区（关键词触发，仅命中时出现）分预算
    const ccSection = buildCharacterCardSection(cc, dialogText, Math.floor(ccBudget * 0.75))
    const eventSection = buildAssociatedEventSection(cc, dialogText, Math.floor(ccBudget * 0.35))
    const wbBudget = adaptiveInjectionBudget(settings.wbInjectionLimit, dialogText.length)
    const residentLimit = Math.min(Math.floor(wbBudget * 0.6), settings.wbInjectionLimit)
    const { resident, scene } = splitWorldBookSections(wb, dialogText, settings.wbInjectionLimit)
    const res = resident.slice(0, residentLimit)
    const sc = scene.slice(0, Math.max(0, wbBudget - res.length))
    const wbParts: string[] = []
    if (res) wbParts.push(`## World Book · 常驻设定\n${res}`)
    if (sc) wbParts.push(`## World Book · 场景触发\n${sc}`)
    const wbSection = wbParts.join('\n\n')
    const parts = [ccSection, eventSection, wbSection].filter(Boolean)
    return parts.length ? parts.join('\n\n') : ''
  } catch {
    return ''
  }
}
