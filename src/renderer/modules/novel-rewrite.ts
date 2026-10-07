/**
 * Chatbox Mod 模块 —— 原作续改（原著域）
 *
 * 导入整本小说资料（JSON：chapters / characterBaselines / evolutionEvents / worldbook），
 * 固化「原著库」（只读），并维护「改写线」（可写，引用原章节 ID）。
 * 与聊天域（世界书/人物卡/会话）完全隔离：独立存储键 + bookId 命名空间。
 *
 * 数据格式见《小说导入资料与格式规范》：顶层 { bookId, bookName, chapters[], characterBaselines[],
 * evolutionEvents[]（带 chapter）, worldbook[] }。导入纯本地解析，零 AI。
 */
import { atom, getDefaultStore } from 'jotai'
import { v4 as uuidv4 } from 'uuid'
import { MOD_STORAGE_KEYS, modGetItem, modSetItem } from './storage'
import type { NovelBaseline, NovelBook, NovelChapter, NovelEvent, NovelWorldEntry, RewriteNode } from './types'

/* ======================== Jotai atom ======================== */

/** 原著域：已导入的书列表（bookId 命名空间，与聊天域隔离） */
export const novelBooksAtom = atom<NovelBook[]>([])

/** 当前正在操作的书（改写工作台 UI 状态） */
export const activeNovelBookIdAtom = atom<string | null>(null)

/* ======================== 导入解析 ======================== */

export interface NovelImportResult {
  ok: boolean
  book?: NovelBook
  errors: string[]
  /** 非阻断问题（空章节、缺字段但可补默认值等） */
  warnings: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [])

/** 归一化原预告条目（容错缺字段） */
function normPreview(v: unknown): Array<{ ch: number; title: string; brief: string }> {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      ch: num(x.ch) || num(x.chIndex) || 0,
      title: str(x.title) || '',
      brief: str(x.brief) || str(x.summary) || '',
    }))
    .filter((x) => x.ch > 0)
}

/**
 * 解析并校验导入 JSON 文本 → NovelBook（纯本地，零 AI）。
 * 校验失败返回 errors 列表（含问题描述，不产生脏数据）；
 * 可补默认值的缺漏（空章节等）记入 warnings，不阻断导入。
 */
export function parseNovelImport(text: string): NovelImportResult {
  const errors: string[] = []
  const warnings: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(String(text ?? ''))
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${String((e as Error)?.message ?? e)}`], warnings }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['顶层必须是 JSON 对象（含 bookId / bookName / chapters）'], warnings }
  }
  const r = raw as Record<string, unknown>
  const bookId = str(r.bookId).trim()
  const bookName = str(r.bookName).trim()
  if (!bookId) errors.push('缺少 bookId（书籍唯一标识）')
  if (!bookName) errors.push('缺少 bookName（书名）')

  // 章节
  const chapters: NovelChapter[] = []
  const chRaw = r.chapters
  if (!Array.isArray(chRaw)) errors.push('缺少 chapters 数组（章节列表）')
  else {
    for (let i = 0; i < chRaw.length; i++) {
      const c = chRaw[i] as Record<string, unknown>
      if (typeof c !== 'object' || c === null) {
        errors.push(`chapters[${i}]：不是对象`)
        continue
      }
      const chIndex = num(c.chIndex) || num(c.chapter)
      const title = str(c.title).trim()
      if (!chIndex) errors.push(`chapters[${i}]：缺少 chIndex（原章节号）`)
      if (!title) warnings.push(`第${chIndex || i + 1}章缺少 title，已用默认标题`)
      if (!str(c.original)) warnings.push(`第${chIndex || i + 1}章原文为空（改写到该章时无底稿）`)
      chapters.push({
        id: str(c.id) || `ch-${chIndex || i + 1}`,
        bookId,
        chIndex,
        title: title || `第${chIndex || i + 1}章`,
        original: str(c.original),
        summary: str(c.summary),
        originalPreview: normPreview(c.originalPreview),
      })
    }
  }
  // 章节按 chIndex 升序
  chapters.sort((a, b) => a.chIndex - b.chIndex)

  // 人物基线
  const baselines: NovelBaseline[] = []
  const blRaw = r.characterBaselines
  if (blRaw !== undefined && !Array.isArray(blRaw)) errors.push('characterBaselines 必须是数组')
  if (Array.isArray(blRaw)) {
    for (let i = 0; i < blRaw.length; i++) {
      const b = blRaw[i] as Record<string, unknown>
      if (typeof b !== 'object' || b === null) {
        errors.push(`characterBaselines[${i}]：不是对象`)
        continue
      }
      const name = str(b.name).trim()
      if (!name) errors.push(`characterBaselines[${i}]：缺少 name`)
      baselines.push({
        id: str(b.id) || `cc-${name || i + 1}`,
        bookId,
        name: name || `未命名${i + 1}`,
        backgroundStory: str(b.backgroundStory),
        keywords: strArr(b.keywords),
        enabled: b.enabled !== false,
      })
    }
  }

  // 演化事件
  const events: NovelEvent[] = []
  const evRaw = r.evolutionEvents
  if (evRaw !== undefined && !Array.isArray(evRaw)) errors.push('evolutionEvents 必须是数组')
  if (Array.isArray(evRaw)) {
    for (let i = 0; i < evRaw.length; i++) {
      const e = evRaw[i] as Record<string, unknown>
      if (typeof e !== 'object' || e === null) {
        errors.push(`evolutionEvents[${i}]：不是对象`)
        continue
      }
      const roleName = str(e.roleName).trim()
      const chapter = num(e.chapter) || num(e.ch)
      if (!roleName) errors.push(`evolutionEvents[${i}]：缺少 roleName`)
      if (!chapter) errors.push(`evolutionEvents[${i}]：缺少 chapter（原章节号）`)
      events.push({
        id: str(e.id) || `ev-${i + 1}`,
        bookId,
        roleName: roleName || '未知',
        content: str(e.content),
        keywords: strArr(e.keywords),
        chapter,
        t: num(e.t),
        frozen: e.frozen === true,
      })
    }
  }
  // 事件按 chapter 升序
  events.sort((a, b) => a.chapter - b.chapter)

  // 世界书
  const worldbook: NovelWorldEntry[] = []
  const wbRaw = r.worldbook
  if (wbRaw !== undefined && !Array.isArray(wbRaw)) errors.push('worldbook 必须是数组')
  if (Array.isArray(wbRaw)) {
    for (let i = 0; i < wbRaw.length; i++) {
      const w = wbRaw[i] as Record<string, unknown>
      if (typeof w !== 'object' || w === null) {
        errors.push(`worldbook[${i}]：不是对象`)
        continue
      }
      const name = str(w.name).trim()
      if (!name) errors.push(`worldbook[${i}]：缺少 name`)
      worldbook.push({
        id: str(w.id) || `wb-${i + 1}`,
        bookId,
        name: name || `设定${i + 1}`,
        content: str(w.content),
        keywords: strArr(w.keywords),
        enabled: w.enabled !== false,
      })
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings }

  const now = Date.now()
  const book: NovelBook = {
    bookId,
    bookName,
    startChIndex: num(r.startChIndex) || chapters[0]?.chIndex || 1,
    chapters,
    baselines,
    events,
    worldbook,
    rewriteNodes: [],
    createdAt: now,
    updatedAt: now,
  }
  return { ok: true, book, errors: [], warnings }
}

/* ======================== 原著库 CRUD（与聊天域隔离） ======================== */

async function persist(books: NovelBook[]): Promise<void> {

  getDefaultStore().set(novelBooksAtom, books)
  await modSetItem(MOD_STORAGE_KEYS.novelBooks, books)
}

/** 导入一本书（bookId 已存在 → 覆盖原著库，保留改写线？不：整书覆盖，改写线重建为空——导入即换书） */
export async function importNovelBook(book: NovelBook): Promise<void> {

  const store = getDefaultStore()
  const books = store.get(novelBooksAtom)
  const next = [...books.filter((x) => x.bookId !== book.bookId), { ...book, updatedAt: Date.now() }]
  await persist(next)
}

/** 删除一本书（连同改写线） */
export async function removeNovelBook(bookId: string): Promise<void> {

  const store = getDefaultStore()
  const next = store.get(novelBooksAtom).filter((x) => x.bookId !== bookId)
  await persist(next)
}

/** 取一本书（无则 null） */
export function getNovelBook(bookId: string): NovelBook | null {
  return getDefaultStore().get(novelBooksAtom).find((x) => x.bookId === bookId) ?? null
}

/** 改写线写入（节点级 upsert：新增节点或按 id 更新） */
export async function upsertRewriteNode(bookId: string, node: RewriteNode): Promise<void> {

  const store = getDefaultStore()
  const books = store.get(novelBooksAtom)
  const book = books.find((x) => x.bookId === bookId)
  if (!book) return
  const idx = book.rewriteNodes.findIndex((n) => n.id === node.id)
  const nodes =
    idx === -1
      ? [...book.rewriteNodes, { ...node, createdAt: node.createdAt || Date.now(), updatedAt: Date.now() }]
      : book.rewriteNodes.map((n, i) => (i === idx ? { ...n, ...node, updatedAt: Date.now() } : n))
  const next = books.map((x) => (x.bookId === bookId ? { ...x, rewriteNodes: nodes, updatedAt: Date.now() } : x))
  await persist(next)
}

/** 清除一本书的全部改写线（重新开始） */
export async function resetRewriteLine(bookId: string): Promise<void> {

  const store = getDefaultStore()
  const next = store
    .get(novelBooksAtom)
    .map((x) => (x.bookId === bookId ? { ...x, rewriteNodes: [], updatedAt: Date.now() } : x))
  await persist(next)
}

/* ======================== 注入集组装（纯代码，零 AI） ======================== */

export interface RewriteInjection {
  /** 前情概要：改写线最近锚点或起点前各章 summary 合并 */
  prior: string
  /** 当前章原文（refChapter 取原著） */
  original: string
  /** 人物基线（全量） */
  baselines: NovelBaseline[]
  /** chapter ≤ N 的演化事件（未来事件不注入） */
  events: NovelEvent[]
  /** 双预告：原（引用原著章节）+ 改（当前节点推导） */
  originalPreview: Array<{ ch: number; title: string; brief: string }>
  revisedPreview: Array<{ ch: string; title: string; brief: string }>
}

/**
 * 按当前改写位置组装注入集（读节点 → 取关联章号 N → 筛 chapter ≤ N 事件）。
 * 纯本地、零 AI、秒级；触发时机：进入改写页 / 切换章节 / 推进下一章。
 */
export function buildRewriteInjection(book: NovelBook, currentNode: RewriteNode | null): RewriteInjection {
  const N = currentNode?.chapter ?? book.startChIndex ?? book.chapters[0]?.chIndex ?? 1
  // 前情概要：改写线已有节点 → 最近锚点；否则起点章之前各章 summary 合并
  let prior = ''
  if (currentNode) {
    prior = currentNode.anchor || ''
  } else {
    prior = book.chapters
      .filter((c) => c.chIndex < N)
      .map((c) => `第${c.chIndex}章 ${c.title}：${c.summary}`)
      .join('\n')
      .slice(0, 3000)
  }
  // 当前章原文：当前节点有改写稿用改写稿，否则取关联原著章
  const refChapter = book.chapters.find((c) => c.id === currentNode?.refChapterId) ?? book.chapters.find((c) => c.chIndex === N)
  const original = currentNode?.revised && currentNode.status === 'finalized' ? currentNode.revised : refChapter?.original ?? ''
  const events = book.events.filter((e) => e.chapter <= N)
  const originalPreview = refChapter?.originalPreview ?? []
  return {
    prior,
    original,
    baselines: book.baselines,
    events,
    originalPreview,
    revisedPreview: currentNode?.revisedPreview ?? [],
  }
}
