/**
 * Chatbox Mod 模块 —— 原著域（原作续改）存储
 *
 * 双域隔离：原著域只被「原作续改」改写页读取，与聊天域（会话 + 自建世界书/人物卡）隔离。
 * 存储走 platform 抽象（mobile SQLite / desktop 文件 / web IndexedDB），bookId 命名空间，集中存一个索引。
 *
 * 只读约束：章节 / 人物基线 / 演化事件 / 世界书在导入后只读；改写产物只写 rewriteNodes，
 * 不复制原文（改写节点用 refChapterId 引用原著章节）。
 */
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { modGetItem, modSetItem, MOD_STORAGE_KEYS } from './storage'
import type { NovelBook, NovelRewriteNode } from './types'
import { parseNovelImport, type NovelImportResult } from './novel-import'

const log = getLogger('mod-novel-store')

/** 集中索引：{ [bookId]: NovelBook } */
type NovelBooksIndex = Record<string, NovelBook>

async function readIndex(): Promise<NovelBooksIndex> {
  return modGetItem<NovelBooksIndex>(MOD_STORAGE_KEYS.novelBooks, {})
}

async function writeIndex(index: NovelBooksIndex): Promise<void> {
  await modSetItem(MOD_STORAGE_KEYS.novelBooks, index)
}

export type NovelImportOutcome = NovelImportResult & { duplicate?: boolean }

/** 导入并落库整本小说（解析 + 校验 + 存原著域）。重复导入覆盖同名 bookId。 */
export async function importNovelBook(jsonText: string): Promise<NovelImportOutcome> {
  const parsed = parseNovelImport(jsonText)
  if (!parsed.ok) return parsed
  const { book, warnings } = parsed
  const index = await readIndex()
  const duplicate = book.bookId in index
  index[book.bookId] = book
  await writeIndex(index)
  log.info(
    `原著导入 ${book.bookId}(${book.bookName})：${book.chapters.length}章 / ${book.characterBaselines.length}人物 / ` +
      `${book.evolutionEvents.length}事件 / ${book.worldbook.length}世界书${duplicate ? '（覆盖）' : ''}`,
  )
  return { ok: true, book, duplicate, warnings }
}

/** 读取某本书（原著域只读）。不存在返回 undefined。 */
export async function getNovelBook(bookId: string): Promise<NovelBook | undefined> {
  const index = await readIndex()
  return index[bookId]
}

/** 是否已导入某本书 */
export async function isNovelImported(bookId: string): Promise<boolean> {
  const index = await readIndex()
  return bookId in index
}

/** 列出全部已导入书（按导入时间倒序） */
export async function listNovelBooks(): Promise<NovelBook[]> {
  const index = await readIndex()
  return Object.values(index).sort((a, b) => b.importedAt - a.importedAt)
}

/** 删除整本书（含改写线）。false = 不存在。 */
export async function removeNovelBook(bookId: string): Promise<boolean> {
  const index = await readIndex()
  if (!(bookId in index)) return false
  delete index[bookId]
  await writeIndex(index)
  log.info(`原著移除 ${bookId}`)
  return true
}

/**
 * 更新某本书的改写线节点（唯一可写入口，只写 rewriteNodes，不触碰只读的章节/基线/事件/世界书）。
 * false = 书不存在。
 */
export async function updateRewriteNodes(bookId: string, nodes: NovelRewriteNode[]): Promise<boolean> {
  const index = await readIndex()
  const book = index[bookId]
  if (!book) return false
  index[bookId] = { ...book, rewriteNodes: nodes }
  await writeIndex(index)
  return true
}

/** 存储健康检查：读一次索引，确认平台存储可用 */
export async function novelStoreHealth(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const index = await readIndex()
    return { ok: true, count: Object.keys(index).length }
  } catch (e) {
    log.warn('novelStoreHealth failed', e)
    return { ok: false, count: 0, error: (e as Error)?.message ?? String(e) }
  }
}
