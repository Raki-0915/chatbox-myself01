/**
 * Chatbox Mod 模块 —— 长文分析（世界书/人物卡自动提取）
 *
 * 将一段长文本按块送入模型，要求输出 JSON 结构的世界信息/人物信息，
 * 再按名称合并去重。移植自 v48 的 analyzeTextAndBuildWorld / mergeAnalysisResult。
 */
import { getLogger } from '@/lib/utils'
import type { CharacterCard, WorldBookEntry } from './types'

const log = getLogger('mod-analyze')

/** 文本分块（按块大小，优先在换行处切分） */
export function splitTextChunks(text: string, chunkSize: number): string[] {
  const t = String(text ?? '')
  if (!t) return []
  if (t.length <= chunkSize) return [t]
  const chunks: string[] = []
  let start = 0
  while (start < t.length) {
    let end = Math.min(start + chunkSize, t.length)
    if (end < t.length) {
      const nl = t.lastIndexOf('\n', end)
      if (nl > start + chunkSize / 2) end = nl
    }
    chunks.push(t.slice(start, end))
    start = end
  }
  return chunks
}

/** 从模型输出中提取 JSON 块（容忍 ```json 包裹/前后缀文本） */
export function extractJsonBlock(raw: string): unknown {
  const s = String(raw ?? '').trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    /* fallthrough */
  }
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      /* fallthrough */
    }
  }
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(s.slice(first, last + 1))
    } catch {
      return null
    }
  }
  return null
}

/** 分析结果（合并前的单块产物） */
export interface AnalysisResult {
  worldBooks?: Array<{ name: string; content: string; keywords: string[] }>
  characters?: Array<{
    name: string
    age?: string
    gender?: string
    occupation?: string
    appearance?: string
    personalityType?: string
    backgroundStory?: string
    relationships?: Array<{ targetName: string; relation: string }>
    keywords?: string[]
  }>
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function hasName(x: unknown): boolean {
  return isObj(x) && typeof x.name === 'string' && (x.name as string).length > 0
}

function normArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 合并多个分析结果（人物按名称取关系并集；世界书按名称取更长内容+关键词并集） */
export function mergeAnalysisResult(results: AnalysisResult[]): AnalysisResult {
  const out: AnalysisResult = { worldBooks: [], characters: [] }
  const wbMap = new Map<string, { content: string; keywords: string[] }>()
  const ccMap = new Map<string, Record<string, unknown>>()

  for (const r of results) {
    for (const w of r.worldBooks ?? []) {
      if (!w || !w.name) continue
      const prev = wbMap.get(w.name)
      if (!prev) {
        wbMap.set(w.name, { content: w.content ?? '', keywords: normArray(w.keywords) })
      } else {
        prev.content = (prev.content?.length ?? 0) >= (w.content?.length ?? 0) ? prev.content : w.content
        prev.keywords = [...new Set([...prev.keywords, ...normArray(w.keywords)])]
      }
    }
    for (const c of r.characters ?? []) {
      if (!c || !c.name) continue
      const prev = ccMap.get(c.name)
      if (!prev) {
        ccMap.set(c.name, { ...c, relationships: Array.isArray(c.relationships) ? c.relationships : [] })
      } else {
        const rels = new Map<string, string>()
        for (const x of [...normRels(prev.relationships), ...normRels(c.relationships)]) rels.set(x.targetName, x.relation)
        prev.relationships = [...rels.entries()].map(([targetName, relation]) => ({ targetName, relation }))
        for (const k of ['age', 'gender', 'occupation', 'appearance', 'personalityType', 'backgroundStory'] as const) {
          if (str(c[k]) && !str(prev[k])) prev[k] = c[k]
        }
        if (str(c.backgroundStory) && str(c.backgroundStory).length > str(prev.backgroundStory ?? '').length) {
          prev.backgroundStory = c.backgroundStory
        }
      }
    }
  }

  out.worldBooks = [...wbMap.entries()].map(([name, v]) => ({ name, content: v.content, keywords: v.keywords }))
  out.characters = [...ccMap.values()].map((v) => ({
    name: str(v.name),
    age: str(v.age),
    gender: str(v.gender),
    occupation: str(v.occupation),
    appearance: str(v.appearance),
    personalityType: str(v.personalityType),
    backgroundStory: str(v.backgroundStory),
    relationships: normRels(v.relationships),
  }))
  return out
}

function normRels(v: unknown): Array<{ targetName: string; relation: string }> {
  if (!Array.isArray(v)) return []
  return v
    .filter(hasName)
    .map((x) => ({
      targetName: str((x as Record<string, unknown>).targetName) || str((x as Record<string, unknown>).name),
      relation: str((x as Record<string, unknown>).relation),
    }))
    .filter((x) => x.targetName)
}

/** 把合并结果转成可写入的条目（与既有条目按名称匹配则更新，否则新增） */
export function analysisToEntries(result: AnalysisResult, now = Date.now()): { wb: WorldBookEntry[]; cc: CharacterCard[] } {
  const wb: WorldBookEntry[] = (result.worldBooks ?? []).map((w) => ({
    id: '', // 由调用方决定：既有 id 或新 uuid
    name: w.name,
    content: w.content,
    keywords: w.keywords,
    enabled: true,
    triggerMode: 'always',
    createdAt: now,
    updatedAt: now,
  }))
  const cc: CharacterCard[] = (result.characters ?? []).map((c) => ({
    id: '',
    name: c.name,
    age: c.age ?? '',
    gender: c.gender ?? '',
    occupation: c.occupation ?? '',
    appearance: c.appearance ?? '',
    height: '',
    weight: '',
    distinguishingFeatures: '',
    personalityType: c.personalityType ?? '',
    strengths: '',
    weaknesses: '',
    hobbies: '',
    backgroundStory: c.backgroundStory ?? '',
    relationships: (c.relationships ?? []).map((r) => ({ targetName: r.targetName, relation: r.relation, description: '' })),
    customAttributes: [],
    characterBook: [],
    enabled: true,
    createdAt: now,
    updatedAt: now,
    versionHistory: [],
  }))
  return { wb, cc }
}

/** 分析提示词（与 v48 行为一致，要求结构化输出） */
export function buildAnalysisPrompt(chunk: string): string {
  return [
    '请阅读以下文本，提取其中所有重要的世界观设定与人物信息，并以 JSON 格式输出。',
    '输出格式必须严格如下（不要输出其他内容）：',
    '{',
    '  "worldBooks": [ { "name": "设定名称", "content": "设定详细描述", "keywords": ["触发关键词"] } ],',
    '  "characters": [ { "name": "人物名", "age": "年龄", "gender": "性别", "occupation": "职业", "appearance": "外貌", "personalityType": "性格", "backgroundStory": "背景故事", "relationships": [ { "targetName": "关系对象", "relation": "关系描述" } ] } ]',
    '}',
    '',
    '要求：',
    '1. 只提取文本中实际出现的信息，不要编造。',
    '2. worldBooks 至少给出 3 个触发关键词。',
    '3. 人物没有的信息字段留空字符串，不要省略字段名。',
    '',
    '--- 待分析文本 ---',
    chunk,
  ].join('\n')
}

/** 解析模型返回（容忍 json 包裹），返回规范 AnalysisResult */
export function parseAnalysisOutput(raw: string): AnalysisResult {
  const parsed = extractJsonBlock(raw)
  if (!parsed || typeof parsed !== 'object') return { worldBooks: [], characters: [] }
  const r = parsed as Record<string, unknown>
  const worldBooks = Array.isArray(r.worldBooks)
    ? r.worldBooks.filter(hasName).map((w) => {
        const o = w as Record<string, unknown>
        return { name: str(o.name), content: str(o.content), keywords: normArray(o.keywords) }
      })
    : []
  const characters = Array.isArray(r.characters)
    ? r.characters
        .filter(hasName)
        .map((c) => {
          const o = c as Record<string, unknown>
          return {
            name: str(o.name),
            age: str(o.age),
            gender: str(o.gender),
            occupation: str(o.occupation),
            appearance: str(o.appearance),
            personalityType: str(o.personalityType),
            backgroundStory: str(o.backgroundStory),
            relationships: normRels(o.relationships),
          }
        })
    : []
  return { worldBooks, characters }
}

/** 默认分块大小 */
export const DEFAULT_CHUNK_SIZE = 5000
