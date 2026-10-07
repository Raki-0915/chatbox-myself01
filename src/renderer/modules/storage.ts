/**
 * Chatbox Mod 模块 —— 存储层
 *
 * 复用官方 platform 存储抽象（mobile 走 SQLite / desktop 走文件 / web 走 IndexedDB），
 * 不使用 localStorage，避免 v48 版本的容量与持久化问题。
 */
import { getLogger } from '@/lib/utils'
import platform from '@/platform'

const log = getLogger('mod-storage')

/** 模块私有存储键（避免与官方 StorageKey 冲突） */
export const MOD_STORAGE_KEYS = {
  worldBooks: 'mod.world-books',
  characterCards: 'mod.character-cards',
  folders: 'mod.folders',
  backups: 'mod.backups',
  log: 'mod.log',
  settings: 'mod.settings',
  bookmarks: 'mod.bookmarks',
  novelBooks: 'mod.novel-books',
} as const

export type ModStorageKey = (typeof MOD_STORAGE_KEYS)[keyof typeof MOD_STORAGE_KEYS]

/** 读取存储值（不存在时返回 initial） */
export async function modGetItem<T>(key: ModStorageKey, initial: T): Promise<T> {
  try {
    const v = await platform.getStoreValue(key)
    if (v === undefined || v === null) return initial
    return v as T
  } catch (e) {
    log.warn(`modGetItem(${key}) failed`, e)
    return initial
  }
}

/** 写入存储值 */
export async function modSetItem<T>(key: ModStorageKey, value: T): Promise<void> {
  try {
    await platform.setStoreValue(key, value)
  } catch (e) {
    log.error(`modSetItem(${key}) failed`, e)
  }
}
