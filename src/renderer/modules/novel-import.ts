/**
 * Chatbox Mod 模块 —— 原著域小说导入解析器（纯函数，零 AI，秒级，可独立单测）
 *
 * 导入整本小说「已分析」的 JSON（四数组，格式见《小说导入资料与格式规范_v1.0.md》）：
 * - chapters            : 章节节点（id / bookId / chIndex / title / original / summary / originalPreview）
 * - characterBaselines  : 人物卡静态基线（name / backgroundStory / keywords / enabled）
 * - evolutionEvents     : 角色演化事件（roleName / content / keywords / chapter / t / frozen）
 * - worldbook           : 世界书条目（name / content / keywords / enabled）
 *
 * 纯本地 JSON.parse + 逐项校验，零 token；解析失败返回错误信息并带行号提示。
 * 与聊天域隔离：只产出「原著域」的 NovelBook，不改动聊天域任何数据。
 */
import type {
  NovelBook,
  NovelChapter,
  NovelCharacterBaseline,
  NovelEvent,
  NovelPreviewItem,
  NovelWorldEntry,
} from './types'

/** 解析结果：成功返回书（附警告）；失败返回错误信息（带行号） */
export type NovelImportResult =
  | { ok: true; book: NovelBook; warnings: string[] }
  | { ok: false; error: string; line?: number }

/** 顶层允许的元数据字段（非四数组，按需读取，未知字段忽略不报错） */
interface NovelImportRaw {
  bookId?: unknown
  bookName?: unknown
  generatedFor?: unknown
  chapters?: unknown
  characterBaselines?: unknown
  evolutionEvents?: unknown
  worldbook?: unknown
}

/* ======================== 基础工具 ======================== */

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function str(x: unknown): string {
  return typeof x === 'string' ? x : ''
}

function num(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined
}

function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : []
}

function bool(x: unknown): boolean {
  return x === true
}

/** 根据 JSON.parse 错误里的字节位置，反推所在行号（1-based） */
function lineAt(text: string, position: number): number {
  let line = 1
  for (let i = 0; i < position && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

/** 从 JSON.parse 错误对象里提取字节位置（现代 V8 报 "at position N"） */
function extractPosition(e: unknown): number | undefined {
  const msg = String((e as Error)?.message ?? e)
  const m = /position\s+(\d+)/.exec(msg)
  return m ? Number(m[1]) : undefined
}

/* ======================== 各数组逐项校验与规范化 ======================== */

/** 规范化章节预告条目（原/改预告通用） */
function toPreviewItem(item: unknown, fallbackTitle: string): NovelPreviewItem {
  const r = isRecord(item) ? item : {}
  const ch = r.ch
  return {
    ch: typeof ch === 'number' || typeof ch === 'string' ? ch : fallbackTitle,
    title: str(r.title) || fallbackTitle,
    brief: str(r.brief),
  }
}

/** 章节节点：必填 id + chIndex（数字）；原文可为空（样例可能有空节点，仅警告不拒绝） */
function toChapter(item: unknown, bookId: string, idx: number): NovelChapter | string {
  if (!isRecord(item)) return `章节[${idx}]不是对象`
  const id = str(item.id)
  const chIndex = num(item.chIndex)
  if (!id) return `章节[${idx}]缺少 id`
  if (chIndex === undefined) return `章节[${idx}](${id})的 chIndex 不是有效数字`
  const previews = arr(item.originalPreview).map((p, i) => toPreviewItem(p, `第${chIndex + i + 1}章`))
  return {
    id,
    bookId,
    chIndex,
    title: str(item.title),
    original: str(item.original),
    summary: str(item.summary),
    originalPreview: previews,
  }
}

/** 人物卡静态基线：必填 name；backgroundStory/keywords/enabled 按规范 */
function toBaseline(item: unknown, bookId: string, idx: number): NovelCharacterBaseline | string {
  if (!isRecord(item)) return `人物[${idx}]不是对象`
  const name = str(item.name)
  if (!name) return `人物[${idx}]缺少 name`
  const id = str(item.id) || `cc-${bookId}-${name}`
  return {
    id,
    bookId,
    name,
    backgroundStory: str(item.backgroundStory),
    keywords: arr(item.keywords).map((k) => str(k)).filter(Boolean),
    enabled: bool(item.enabled),
  }
}

/** 角色演化事件：必填 roleName + content + chapter（数字） */
function toEvent(item: unknown, bookId: string, idx: number): NovelEvent | string {
  if (!isRecord(item)) return `事件[${idx}]不是对象`
  const roleName = str(item.roleName)
  if (!roleName) return `事件[${idx}]缺少 roleName`
  if (!str(item.content)) return `事件[${idx}](${roleName})缺少 content`
  const chapter = num(item.chapter)
  if (chapter === undefined) return `事件[${idx}](${roleName})的 chapter 不是有效数字`
  const id = str(item.id) || `ev-${bookId}-${idx}`
  return {
    id,
    bookId,
    roleName,
    content: str(item.content),
    keywords: arr(item.keywords).map((k) => str(k)).filter(Boolean),
    chapter,
    t: num(item.t) ?? 0,
    frozen: bool(item.frozen),
  }
}

/** 世界书条目：必填 name + content */
function toWorldEntry(item: unknown, bookId: string, idx: number): NovelWorldEntry | string {
  if (!isRecord(item)) return `世界书[${idx}]不是对象`
  const name = str(item.name)
  if (!name) return `世界书[${idx}]缺少 name`
  if (!str(item.content)) return `世界书[${idx}](${name})缺少 content`
  const id = str(item.id) || `wb-${bookId}-${idx}`
  return {
    id,
    bookId,
    name,
    content: str(item.content),
    keywords: arr(item.keywords).map((k) => str(k)).filter(Boolean),
    enabled: bool(item.enabled),
  }
}

/* ======================== 主解析入口 ======================== */

/**
 * 解析并校验整本小说导入 JSON（纯本地、零 AI）。
 * @param jsonText 原始 JSON 文本
 * @returns 成功返回规范化 NovelBook（原著域），失败返回错误信息 + 行号
 */
export function parseNovelImport(jsonText: string): NovelImportResult {
  const text = String(jsonText ?? '')
  if (!text.trim()) return { ok: false, error: '文件为空' }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    const pos = extractPosition(e)
    return {
      ok: false,
      error: `JSON 解析失败：${(e as Error)?.message ?? e}`,
      line: pos !== undefined ? lineAt(text, pos) : undefined,
    }
  }
  if (!isRecord(raw)) return { ok: false, error: '顶层不是 JSON 对象（应为 { bookId, chapters, … }）' }

  const top = raw as unknown as NovelImportRaw
  const bookId = str(top.bookId)
  if (!bookId) return { ok: false, error: '缺少 bookId' }

  // 逐数组解析，任一数组有非法条目即整体失败并给出定位
  const errors: string[] = []
  const chapters: NovelChapter[] = []
  arr(top.chapters).forEach((c, i) => {
    const r = toChapter(c, bookId, i)
    if (typeof r === 'string') errors.push(`chapters: ${r}`)
    else chapters.push(r)
  })
  const characterBaselines: NovelCharacterBaseline[] = []
  arr(top.characterBaselines).forEach((c, i) => {
    const r = toBaseline(c, bookId, i)
    if (typeof r === 'string') errors.push(`characterBaselines: ${r}`)
    else characterBaselines.push(r)
  })
  const evolutionEvents: NovelEvent[] = []
  arr(top.evolutionEvents).forEach((c, i) => {
    const r = toEvent(c, bookId, i)
    if (typeof r === 'string') errors.push(`evolutionEvents: ${r}`)
    else evolutionEvents.push(r)
  })
  const worldbook: NovelWorldEntry[] = []
  arr(top.worldbook).forEach((c, i) => {
    const r = toWorldEntry(c, bookId, i)
    if (typeof r === 'string') errors.push(`worldbook: ${r}`)
    else worldbook.push(r)
  })

  if (errors.length > 0) {
    return { ok: false, error: `共 ${errors.length} 处校验失败：\n${errors.slice(0, 10).join('\n')}` }
  }

  // 宽松提示：内容为空的节点不拒绝整本书，但列入警告（样例 ch-297 即空节点）
  const warnings: string[] = []
  chapters.forEach((c) => {
    if (!c.original.trim()) warnings.push(`章节 ${c.id}（chIndex=${c.chIndex}）原文为空`)
  })
  characterBaselines.forEach((c) => {
    if (!c.backgroundStory.trim()) warnings.push(`人物 ${c.id}（${c.name}）背景故事为空`)
  })
  worldbook.forEach((c) => {
    if (!c.content.trim()) warnings.push(`世界书 ${c.id}（${c.name}）内容为空`)
  })

  const book: NovelBook = {
    bookId,
    bookName: str(top.bookName),
    generatedFor: str(top.generatedFor),
    startChapter: chapters.length > 0 ? chapters[0].chIndex : 1,
    previewCount: 3,
    chapters,
    characterBaselines,
    evolutionEvents,
    worldbook,
    rewriteNodes: [],
    importedAt: Date.now(),
  }
  return { ok: true, book, warnings }
}

/**
 * 导出 CSV / JSON 解析行号工具（供 UI 展示「第几行出错」用）
 */
export function lineNumber(text: string, position: number): number {
  return lineAt(text, position)
}
