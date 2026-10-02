/**
 * Chatbox Mod 模块 —— 小说分章 / 续写
 *
 * 移植自 v48 的 v283 系列：
 * - 正则切章（第X章/回/节/卷、Chapter N、楔子/序章/尾声/番外等；无标题按块兜底）
 * - AI 生成 3 个改写方案（JSON）
 * - 按方案完整改写
 * - 建"小说·书名"会话并把每章作为 user 消息推入
 */
import { getLogger } from '@/lib/utils'
import { rendererApplication } from '@/app/renderer-application'
import { createModel } from '@/adapters'
import { createMessage } from '@shared/types'
import type { SessionSettings } from '@shared/types'
import { extractJsonBlock } from './analyze'

const log = getLogger('mod-novel')

/* ======================== 章节切分 ======================== */

/** 中文/英文章节标题正则（v48 行为一致） */
export function splitChapters(text: string): Array<{ title: string; content: string }> {
  const t = String(text ?? '')
  if (!t.trim()) return []

  const pattern =
    /(?:^|\n)((?:第[0-9零一二三四五六七八九十百千万两]+[章回节卷部篇]|Chapter\s*\d+|[Cc]hapter\s*[一二三四五六七八九十百千万]+|楔子|序章|序言|引子|前言|尾声|终章|后记|番外篇|番外|外传|结局)(?:\s*[:：\-—]?\s*[^\n]*)?)(?=\n|$)/g

  const matches: Array<{ title: string; start: number }> = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(t)) !== null) {
    matches.push({ title: m[1].trim(), start: m.index + m[1].indexOf(m[1]) - (m[1].startsWith('\n') ? 1 : 0) })
    if (matches.length > 500) break
  }

  if (matches.length === 0) {
    // 兜底：无标题按块切分
    return splitTextBlocks(t).map((c, i) => ({ title: `第${cnNum(i + 1)}部分`, content: c }))
  }

  const chapters: Array<{ title: string; content: string }> = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start
    const end = i + 1 < matches.length ? matches[i + 1].start : t.length
    const title = matches[i].title.replace(/^第[0-9零一二三四五六七八九十百千万两]+[章回节卷部篇]\s*/, (x) => x.trimEnd()).trim()
    const content = t.slice(start, end).trim()
    if (content) chapters.push({ title: title || `第${cnNum(i + 1)}章`, content })
  }
  return chapters
}

function cnNum(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n < 10) return digits[n]
  if (n < 100) {
    const a = Math.floor(n / 10)
    const b = n % 10
    return (a === 1 ? '' : digits[a]) + '十' + (b ? digits[b] : '')
  }
  return String(n)
}

/** 按块切分（默认 5000 字，优先在换行处断） */
export function splitTextBlocks(text: string, size = 5000): string[] {
  const t = String(text ?? '')
  if (!t) return []
  if (t.length <= size) return [t]
  const out: string[] = []
  let start = 0
  while (start < t.length) {
    let end = Math.min(start + size, t.length)
    if (end < t.length) {
      const nl = t.lastIndexOf('\n', end)
      if (nl > start + size / 2) end = nl
    }
    out.push(t.slice(start, end))
    start = end
  }
  return out
}

/* ======================== AI 改写 ======================== */

export interface RewritePlan {
  index: number
  title: string
  description: string
  outline: string
}

function resultText(r: { contentParts?: unknown[]; content?: unknown }): string {
  if (Array.isArray(r.contentParts)) {
    const t = r.contentParts
      .filter((p): p is { type: 'text'; text: string } => Boolean(p && typeof p === 'object' && (p as { type?: unknown }).type === 'text'))
      .map((p) => String((p as { text?: unknown }).text ?? ''))
      .join('')
    if (t) return t
  }
  return typeof r.content === 'string' ? r.content : ''
}

/** 生成 3 个改写方案（JSON） */
export async function v283GenOptions(
  sessionSettings: SessionSettings,
  context: string,
  currentChapter: string
): Promise<RewritePlan[]> {
  const model = await createModel(sessionSettings)
  const prompt = [
    '你是小说编辑。请根据下面的剧情上下文与当前章节，给出 3 个不同的"后续情节走向"改写方案。',
    '输出 JSON 数组，每项：{ "index": 1, "title": "方案标题", "description": "一句话说明", "outline": "分点剧情大纲" }',
    '只输出 JSON，不要多余文字。',
    '',
    `--- 剧情上下文（前情） ---\n${String(context ?? '').slice(0, 8000)}`,
    '',
    `--- 当前章节 ---\n${String(currentChapter ?? '').slice(0, 8000)}`,
  ].join('\n')
  const r = await model.chat(
    [
      { role: 'system', content: '你是资深小说编辑，只输出 JSON。' },
      { role: 'user', content: prompt },
    ], {}
  )
  const parsed = extractJsonBlock(resultText(r))
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, i) => ({
      index: i + 1,
      title: String(x.title ?? `方案${i + 1}`),
      description: String(x.description ?? ''),
      outline: String(x.outline ?? ''),
    }))
    .slice(0, 3)
}

/** 按方案完整改写（原文章节全文 + 方案大纲） */
export async function v283Rewrite(sessionSettings: SessionSettings, fullText: string, plan: RewritePlan): Promise<string> {
  const model = await createModel(sessionSettings)
  const prompt = [
    '你是小说作者。按照给定的"改写方案"重写下面这篇章节。',
    '要求：',
    '1. 保留原文人物、既有设定与文风；',
    '2. 严格按方案大纲推进情节；',
    '3. 输出完整章节正文（不做任何解释说明）。',
    '',
    `--- 改写方案 ---\n${plan.title}\n${plan.description}\n${plan.outline}`,
    '',
    `--- 原文 ---\n${String(fullText ?? '').slice(0, 8000)}`,
  ].join('\n')
  const r = await model.chat(
    [
      { role: 'system', content: '你是小说作者，直接输出正文。' },
      { role: 'user', content: prompt },
    ], {}
  )
  const out = resultText(r)
  if (!out.trim()) throw new Error('模型未返回正文')
  return out
}

/** 续写（基于最近上下文，生成下一段） */
export async function v27Continue(sessionSettings: SessionSettings, context: string, extra: string): Promise<string> {
  const model = await createModel(sessionSettings)
  const prompt = [
    '你是小说作者。请根据下面的上下文续写后续内容。',
    '要求：保持人物性格、叙事风格与节奏；自然衔接；输出续写正文（不解释）。',
    '',
    `--- 前文上下文 ---\n${String(context ?? '').slice(0, 8000)}`,
    extra ? `\n--- 补充要求 ---\n${extra}` : '',
  ].join('\n')
  const r = await model.chat(
    [
      { role: 'system', content: '你是小说作者，直接输出续写正文。' },
      { role: 'user', content: prompt },
    ], {}
  )
  const out = resultText(r)
  if (!out.trim()) throw new Error('模型未返回续写内容')
  return out
}

/* ======================== 会话操作 ======================== */

/** 建"小说·书名"会话 */
export async function v283EnsureSession(title: string): Promise<string> {
  const name = title.trim() ? `小说·${title.trim().slice(0, 30)}` : `小说·未命名`
  const session = await rendererApplication.sessions.createSession({
    name,
    messages: [],
    type: 'chat',
    settings: {},
  })
  return session.id
}

/** 每章作为 user 消息推入会话 */
export async function v283PushChapter(sid: string, chapterTitle: string, chapterContent: string): Promise<void> {
  const text = `【${chapterTitle}】\n${chapterContent}`
  await rendererApplication.sessions.updateMessages(sid, (messages) => [...(messages ?? []), createMessage(undefined, text)])
}
