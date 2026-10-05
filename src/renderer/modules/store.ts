/**
 * Chatbox Mod 模块 —— 数据 Store
 *
 * 世界书/人物卡/文件夹/日志/备份/设置 的内存缓存 + 官方存储持久化。
 * React 侧通过 Jotai atom 订阅；非 React 侧（提示词注入/自动更新）直接用 CRUD 函数。
 */
import { atom } from 'jotai'
import { v4 as uuidv4 } from 'uuid'
import { MOD_STORAGE_KEYS, modGetItem, modSetItem } from './storage'
import type { CharacterCard, ModBackup, ModFolder, ModLogEntry, ModSettings, SessionBookmark, WorldBookEntry } from './types'
import { clearSessionBookmarks, dropBookmarksForMessages, toggleBookmark } from './branches'

/* ======================== 默认值 ======================== */

export const DEFAULT_MOD_SETTINGS: ModSettings = {
  autoUpdateEnabled: false,
  requireConfirm: true,
  recentMessages: 16,
  backupLimit: 5,
  wbInjectionLimit: 4000,
  ccInjectionLimit: 6000,
  siliconflowApiKey: '',
  chatMode: 'creation',
}

/* ======================== Jotai atoms ======================== */

export const worldBooksAtom = atom<WorldBookEntry[]>([])
export const characterCardsAtom = atom<CharacterCard[]>([])
export const foldersAtom = atom<ModFolder[]>([])
export const modSettingsAtom = atom<ModSettings>(DEFAULT_MOD_SETTINGS)
export const modLogAtom = atom<ModLogEntry[]>([])
export const modBackupsAtom = atom<ModBackup[]>([])
/** 对话存档分支点（会话级） */
export const bookmarksAtom = atom<SessionBookmark[]>([])
/** 群聊点名发言：本轮回合由哪个角色带头（一次性，prompt 注入时消费后清空） */
export const groupSpotlightAtom = atom<string | null>(null)

/** 是否已从存储加载过（避免并发重复加载） */
let loaded = false
let loadPromise: Promise<void> | null = null

/** 一次性加载全部模块数据（应用启动时调用，幂等） */
export async function loadModStore(): Promise<void> {
  if (loaded) return
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const [wb, cc, folders, settings, log, backups, bookmarks] = await Promise.all([
      modGetItem<WorldBookEntry[]>(MOD_STORAGE_KEYS.worldBooks, []),
      modGetItem<CharacterCard[]>(MOD_STORAGE_KEYS.characterCards, []),
      modGetItem<ModFolder[]>(MOD_STORAGE_KEYS.folders, []),
      modGetItem<ModSettings>(MOD_STORAGE_KEYS.settings, DEFAULT_MOD_SETTINGS),
      modGetItem<ModLogEntry[]>(MOD_STORAGE_KEYS.log, []),
      modGetItem<ModBackup[]>(MOD_STORAGE_KEYS.backups, []),
      modGetItem<SessionBookmark[]>(MOD_STORAGE_KEYS.bookmarks, []),
    ])
    // 直接写 atom 初始值（getDefaultStore 在 renderer 中可用）
    const { getDefaultStore } = await import('jotai')
    const store = getDefaultStore()
    store.set(worldBooksAtom, wb)
    store.set(characterCardsAtom, cc)
    store.set(foldersAtom, folders)
    store.set(modSettingsAtom, { ...DEFAULT_MOD_SETTINGS, ...settings })
    store.set(modLogAtom, log)
    store.set(modBackupsAtom, backups)
    store.set(bookmarksAtom, bookmarks)
    loaded = true
  })()
  return loadPromise
}

/* ======================== 世界书 CRUD ======================== */

export async function addOrUpdateWorldBook(entry: WorldBookEntry): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const list = store.get(worldBooksAtom)
  const now = Date.now()
  const idx = list.findIndex((x) => x.id === entry.id)
  const next =
    idx === -1
      ? [{ ...entry, createdAt: now, updatedAt: now }, ...list]
      : list.map((x, i) => {
          if (i !== idx) return x
          // 覆盖前把旧内容压入版本历史（截断保留最近 20 份），供单条恢复
          const prev = x.content ?? ''
          const history =
            prev && prev !== String(entry.content ?? '')
              ? [...(x.history ?? []), { t: now, content: prev }].slice(-20)
              : x.history ?? []
          return { ...x, ...entry, updatedAt: now, history }
        })
  store.set(worldBooksAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.worldBooks, next)
}

/** 恢复世界书历史版本（index 为 history 数组下标；恢复后该版本移出历史，最新内容进历史） */
export async function restoreWorldBookVersion(id: string, index: number): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const list = store.get(worldBooksAtom)
  const item = list.find((x) => x.id === id)
  if (!item?.history?.[index]) return
  const now = Date.now()
  const target = item.history[index]
  const history = [...item.history.filter((_, i) => i !== index), { t: now, content: item.content ?? '' }].slice(-20)
  const next = list.map((x) =>
    x.id === id ? { ...x, content: target.content, updatedAt: now, history } : x
  )
  store.set(worldBooksAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.worldBooks, next)
}

export async function removeWorldBook(id: string): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const next = store.get(worldBooksAtom).filter((x) => x.id !== id)
  store.set(worldBooksAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.worldBooks, next)
}

export async function toggleWorldBook(id: string, enabled: boolean): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const next = store.get(worldBooksAtom).map((x) => (x.id === id ? { ...x, enabled, updatedAt: Date.now() } : x))
  store.set(worldBooksAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.worldBooks, next)
}

/* ======================== 批量操作（世界书/人物卡通用） ======================== */

/** 批量移动到文件夹（folderId 传 undefined 表示移出文件夹） */
export async function moveItemsToFolder(kind: 'wb' | 'cc', ids: string[], folderId?: string): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const now = Date.now()
  if (kind === 'wb') {
    const next = store.get(worldBooksAtom).map((x) => (ids.includes(x.id) ? { ...x, folderId, updatedAt: now } : x))
    store.set(worldBooksAtom, next)
    await modSetItem(MOD_STORAGE_KEYS.worldBooks, next)
  } else {
    const next = store.get(characterCardsAtom).map((x) => (ids.includes(x.id) ? { ...x, folderId, updatedAt: now } : x))
    store.set(characterCardsAtom, next)
    await modSetItem(MOD_STORAGE_KEYS.characterCards, next)
  }
}

/** 批量启用/停用 */
export async function setItemsEnabled(kind: 'wb' | 'cc', ids: string[], enabled: boolean): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const now = Date.now()
  if (kind === 'wb') {
    const next = store.get(worldBooksAtom).map((x) => (ids.includes(x.id) ? { ...x, enabled, updatedAt: now } : x))
    store.set(worldBooksAtom, next)
    await modSetItem(MOD_STORAGE_KEYS.worldBooks, next)
  } else {
    const next = store.get(characterCardsAtom).map((x) => (ids.includes(x.id) ? { ...x, enabled, updatedAt: now } : x))
    store.set(characterCardsAtom, next)
    await modSetItem(MOD_STORAGE_KEYS.characterCards, next)
  }
}

/** 批量删除 */
export async function removeItems(kind: 'wb' | 'cc', ids: string[]): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  if (kind === 'wb') {
    const next = store.get(worldBooksAtom).filter((x) => !ids.includes(x.id))
    store.set(worldBooksAtom, next)
    await modSetItem(MOD_STORAGE_KEYS.worldBooks, next)
  } else {
    const next = store.get(characterCardsAtom).filter((x) => !ids.includes(x.id))
    store.set(characterCardsAtom, next)
    await modSetItem(MOD_STORAGE_KEYS.characterCards, next)
  }
}

/* ======================== 人物卡 CRUD ======================== */

export function createEmptyCharacterCard(): CharacterCard {
  return {
    id: uuidv4(),
    name: '',
    age: '',
    gender: '',
    occupation: '',
    appearance: '',
    height: '',
    weight: '',
    distinguishingFeatures: '',
    personalityType: '',
    strengths: '',
    weaknesses: '',
    hobbies: '',
    backgroundStory: '',
    relationships: [],
    customAttributes: [],
    characterBook: [],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    versionHistory: [],
  }
}

function snapshotCard(card: CharacterCard): string {
  const { versionHistory: _vh, ...rest } = card
  return JSON.stringify(rest)
}

export async function addOrUpdateCharacterCard(card: CharacterCard): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const list = store.get(characterCardsAtom)
  const now = Date.now()
  const idx = list.findIndex((x) => x.id === card.id)
  let next: CharacterCard[]
  if (idx === -1) {
    const fresh: CharacterCard = {
      ...createEmptyCharacterCard(),
      ...card,
      id: card.id || uuidv4(),
      createdAt: now,
      updatedAt: now,
      versionHistory: [{ version: 1, timestamp: now, snapshot: snapshotCard(card) }],
    }
    next = [fresh, ...list]
  } else {
    const old = list[idx]
    const ver = (old.versionHistory.at(-1)?.version ?? 0) + 1
    const history = [...old.versionHistory, { version: ver, timestamp: now, snapshot: snapshotCard(card) }].slice(-20)
    const merged: CharacterCard = { ...old, ...card, updatedAt: now, versionHistory: history }
    next = list.map((x, i) => (i === idx ? merged : x))
  }
  store.set(characterCardsAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.characterCards, next)
}

export async function removeCharacterCard(id: string): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const next = store.get(characterCardsAtom).filter((x) => x.id !== id)
  store.set(characterCardsAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.characterCards, next)
}

export async function toggleCharacterCard(id: string, enabled: boolean): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const next = store.get(characterCardsAtom).map((x) => (x.id === id ? { ...x, enabled, updatedAt: Date.now() } : x))
  store.set(characterCardsAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.characterCards, next)
}

export async function restoreCharacterCardVersion(id: string, version: number): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const card = store.get(characterCardsAtom).find((x) => x.id === id)
  if (!card) return
  const snap = card.versionHistory.find((v) => v.version === version)
  if (!snap) return
  const restored = JSON.parse(snap.snapshot) as Omit<CharacterCard, 'id' | 'versionHistory'>
  await addOrUpdateCharacterCard({ ...restored, id: card.id, enabled: card.enabled, versionHistory: card.versionHistory })
}

/* ======================== 文件夹 ======================== */

export async function upsertFolder(folder: ModFolder): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const list = store.get(foldersAtom)
  const next = list.some((x) => x.id === folder.id)
    ? list.map((x) => (x.id === folder.id ? folder : x))
    : [...list, folder]
  store.set(foldersAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.folders, next)
}

export async function removeFolder(id: string): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const next = store.get(foldersAtom).filter((x) => x.id !== id)
  store.set(foldersAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.folders, next)
}

/* ======================== 模块设置 ======================== */

export async function updateModSettings(patch: Partial<ModSettings>): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const next = { ...store.get(modSettingsAtom), ...patch }
  store.set(modSettingsAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.settings, next)
}

/* ======================== 日志与备份 ======================== */

export async function modLog(kind: ModLogEntry['kind'], detail: unknown, sid?: string | null): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const arr = store.get(modLogAtom)
  const next = [{ t: Date.now(), kind, detail, sid: sid ?? null }, ...arr].slice(0, 200)
  store.set(modLogAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.log, next)
}

export async function clearModLog(): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  getDefaultStore().set(modLogAtom, [])
  await modSetItem(MOD_STORAGE_KEYS.log, [])
}

/** 生成自动更新前的备份快照（最多 backupLimit 份） */
export async function pushModBackup(backup: ModBackup): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const limit = store.get(modSettingsAtom).backupLimit || 5
  const arr = store.get(modBackupsAtom)
  const next = [backup, ...arr].slice(0, limit)
  store.set(modBackupsAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.backups, next)
}

/** 导入整包数据（覆盖式；由 export.ts 调用） */
export async function importModPayload(payload: Partial<{
  settings: unknown
  folders: unknown
  worldBooks: unknown
  characterCards: unknown
  log: unknown
  backups: unknown
}>): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  if (payload.settings !== undefined) {
    const merged = { ...DEFAULT_MOD_SETTINGS, ...(payload.settings as Partial<ModSettings>) }
    store.set(modSettingsAtom, merged)
    await modSetItem(MOD_STORAGE_KEYS.settings, merged)
  }
  if (payload.folders !== undefined) {
    store.set(foldersAtom, payload.folders as ModFolder[])
    await modSetItem(MOD_STORAGE_KEYS.folders, payload.folders as ModFolder[])
  }
  if (payload.worldBooks !== undefined) {
    store.set(worldBooksAtom, payload.worldBooks as WorldBookEntry[])
    await modSetItem(MOD_STORAGE_KEYS.worldBooks, payload.worldBooks as WorldBookEntry[])
  }
  if (payload.characterCards !== undefined) {
    store.set(characterCardsAtom, payload.characterCards as CharacterCard[])
    await modSetItem(MOD_STORAGE_KEYS.characterCards, payload.characterCards as CharacterCard[])
  }
  if (payload.log !== undefined) {
    store.set(modLogAtom, payload.log as ModLogEntry[])
    await modSetItem(MOD_STORAGE_KEYS.log, payload.log as ModLogEntry[])
  }
  if (payload.backups !== undefined) {
    store.set(modBackupsAtom, payload.backups as ModBackup[])
    await modSetItem(MOD_STORAGE_KEYS.backups, payload.backups as ModBackup[])
  }
}

/** 恢复备份：写回变更前条目、按名称撤销新增条目 */
export async function restoreModBackup(index: number): Promise<{ ok: boolean; done: number; failed: number; error?: string }> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const backups = store.get(modBackupsAtom)
  const snap = backups[index]
  if (!snap) return { ok: false, done: 0, failed: 0, error: '备份不存在' }
  let done = 0
  let failed = 0
  try {
    for (const w of snap.wbBack ?? []) {
      if (w?.id) {
        await addOrUpdateWorldBook({ id: w.id, name: w.name, content: w.content ?? '', keywords: w.keywords ?? [], enabled: w.enabled !== false })
        done++
      }
    }
    for (const c of snap.ccBack ?? []) {
      if (c?.id) {
        await addOrUpdateCharacterCard({ ...createEmptyCharacterCard(), ...c, enabled: c.enabled !== false })
        done++
      }
    }
    const allWb = store.get(worldBooksAtom)
    const allCc = store.get(characterCardsAtom)
    for (const nm of snap.wbAddNames ?? []) {
      for (const x of allWb.filter((e) => e.name === nm)) {
        try {
          await removeWorldBook(x.id)
          done++
        } catch {
          failed++
        }
      }
    }
    for (const nm of snap.ccAddNames ?? []) {
      for (const x of allCc.filter((e) => e.name === nm)) {
        try {
          await removeCharacterCard(x.id)
          done++
        } catch {
          failed++
        }
      }
    }
    return { ok: true, done, failed }
  } catch (e) {
    return { ok: false, done, failed, error: String((e as Error)?.message ?? e) }
  }
}

/* ======================== 对话存档分支点 CRUD ======================== */

async function persistBookmarks(next: SessionBookmark[]): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  store.set(bookmarksAtom, next)
  await modSetItem(MOD_STORAGE_KEYS.bookmarks, next)
}

/** 打点/取消（toggle）。返回是否新增（true=打点，false=取消） */
export async function toggleSessionBookmark(
  sessionId: string,
  messageId: string,
  preview: string,
  label?: string
): Promise<{ added: boolean }> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const { list, added } = toggleBookmark(store.get(bookmarksAtom), sessionId, messageId, preview, label)
  await persistBookmarks(list)
  return { added }
}

/** 删除消息 → 联动清理对应存档点（多选删除传多条 messageId） */
export async function removeBookmarksByMessageIds(sessionId: string, messageIds: string[]): Promise<void> {
  if (!messageIds.length) return
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const next = dropBookmarksForMessages(store.get(bookmarksAtom), sessionId, messageIds)
  if (next.length === store.get(bookmarksAtom).length) return
  await persistBookmarks(next)
}

/** 清空某会话全部存档点 */
export async function clearSessionBookmarksStore(sessionId: string): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  const store = getDefaultStore()
  const next = clearSessionBookmarks(store.get(bookmarksAtom), sessionId)
  if (next.length === store.get(bookmarksAtom).length) return
  await persistBookmarks(next)
}

/* ======================== 存档点跳转请求（UI 跨组件信号） ======================== */

/** 存档点列表弹窗 → MessageList：请求滚动定位某消息 */
export const bookmarkJumpRequestAtom = atom<{ sessionId: string; messageId: string } | null>(null)

/** 发起跳转请求（弹窗点击存档点时调用） */
export async function setBookmarkJumpRequest(target: { sessionId: string; messageId: string } | null): Promise<void> {
  const { getDefaultStore } = await import('jotai')
  getDefaultStore().set(bookmarkJumpRequestAtom, target)
}
