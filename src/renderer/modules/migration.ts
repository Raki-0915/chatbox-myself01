/**
 * Chatbox Mod 模块 —— v48 数据迁移
 *
 * v48 版把世界书/人物卡存在 localStorage（键 WorldBooks / CharacterCards），
 * 文件夹 chatbox_folders、备份 chatbox_mod_backups、日志 v284_log。
 * 本模块把这些旧数据合并进官方存储（SQLite/文件），按名称去重，保留既有条目。
 */
import { getDefaultStore } from 'jotai'
import { v4 as uuidv4 } from 'uuid'
import { getLogger } from '@/lib/utils'
import { characterCardsAtom, foldersAtom, modBackupsAtom, modLogAtom, worldBooksAtom } from './store'
import type { CharacterCard, ModBackup, ModLogEntry, WorldBookEntry } from './types'

const log = getLogger('mod-migration')

export interface MigrationResult {
  done: boolean
  alreadyMigrated?: boolean
  worldBooksAdded: number
  characterCardsAdded: number
  foldersAdded: number
  backupsAdded: number
  logEntriesAdded: number
  error?: string
}

const MIGRATED_FLAG = 'mod.migrated-v48'

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch (e) {
    log.warn(`read v48 key ${key} failed`, e)
    return null
  }
}

function normWb(raw: unknown): WorldBookEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name) return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id : uuidv4(),
    name: o.name,
    content: typeof o.content === 'string' ? o.content : '',
    keywords: Array.isArray(o.keywords) ? o.keywords.map((k) => String(k)) : [],
    enabled: o.enabled !== false,
    triggerMode: o.triggerMode === 'keyword' ? 'keyword' : 'always',
    order: typeof o.order === 'number' ? o.order : 0,
    folderId: typeof o.folderId === 'string' ? o.folderId : undefined,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
  }
}

function normCc(raw: unknown): CharacterCard | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name) return null
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  return {
    id: typeof o.id === 'string' && o.id ? o.id : uuidv4(),
    name: o.name,
    age: str('age'),
    gender: str('gender'),
    occupation: str('occupation'),
    appearance: str('appearance'),
    height: str('height'),
    weight: str('weight'),
    distinguishingFeatures: str('distinguishingFeatures'),
    personalityType: str('personalityType'),
    strengths: str('strengths'),
    weaknesses: str('weaknesses'),
    hobbies: str('hobbies'),
    backgroundStory: str('backgroundStory'),
    relationships: Array.isArray(o.relationships)
      ? o.relationships
          .filter((r) => r && typeof r === 'object' && typeof (r as Record<string, unknown>).targetName === 'string')
          .map((r) => {
            const rr = r as Record<string, unknown>
            return {
              targetName: String(rr.targetName),
              relation: typeof rr.relation === 'string' ? rr.relation : '',
              description: typeof rr.description === 'string' ? rr.description : '',
            }
          })
      : [],
    customAttributes: Array.isArray(o.customAttributes)
      ? o.customAttributes
          .filter((a) => a && typeof a === 'object')
          .map((a) => {
            const aa = a as Record<string, unknown>
            return { key: String(aa.key ?? ''), value: String(aa.value ?? '') }
          })
      : [],
    characterBook: Array.isArray(o.characterBook) ? o.characterBook.map(normWb).filter((x): x is WorldBookEntry => !!x) : [],
    folderId: typeof o.folderId === 'string' ? o.folderId : undefined,
    enabled: o.enabled !== false,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
    versionHistory: Array.isArray(o.versionHistory) ? (o.versionHistory as CharacterCard['versionHistory']) : [],
  }
}

/** 执行迁移（幂等：已迁移则跳过） */
export async function migrateV48Data(): Promise<MigrationResult> {
  const store = getDefaultStore()
  const flag = localStorage.getItem(MIGRATED_FLAG)
  if (flag === '1') return { done: true, alreadyMigrated: true, worldBooksAdded: 0, characterCardsAdded: 0, foldersAdded: 0, backupsAdded: 0, logEntriesAdded: 0 }

  const result: MigrationResult = { done: false, worldBooksAdded: 0, characterCardsAdded: 0, foldersAdded: 0, backupsAdded: 0, logEntriesAdded: 0 }
  try {
    const existingWb = new Set(store.get(worldBooksAtom).map((w) => w.name))
    const existingCc = new Set(store.get(characterCardsAtom).map((c) => c.name))
    const existingFolder = new Set(store.get(foldersAtom).map((f) => f.id))
    const wbAtom = store.get(worldBooksAtom)
    const ccAtom = store.get(characterCardsAtom)

    // 世界书
    const rawWb = readLocal<unknown[]>('WorldBooks')
    if (Array.isArray(rawWb)) {
      const add: WorldBookEntry[] = []
      for (const r of rawWb) {
        const e = normWb(r)
        if (e && !existingWb.has(e.name)) add.push(e)
      }
      if (add.length) {
        store.set(worldBooksAtom, [...add, ...wbAtom])
        result.worldBooksAdded = add.length
      }
    }

    // 人物卡
    const rawCc = readLocal<unknown[]>('CharacterCards')
    if (Array.isArray(rawCc)) {
      const add: CharacterCard[] = []
      for (const r of rawCc) {
        const e = normCc(r)
        if (e && !existingCc.has(e.name)) add.push(e)
      }
      if (add.length) {
        store.set(characterCardsAtom, [...add, ...ccAtom])
        result.characterCardsAdded = add.length
      }
    }

    // 文件夹
    const rawFolders = readLocal<unknown[]>('chatbox_folders')
    if (Array.isArray(rawFolders)) {
      const add = rawFolders
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as Record<string, unknown>).id === 'string')
        .map((f) => ({
          id: String(f.id),
          name: String(f.name ?? '未命名'),
          kind: (f.kind === 'cc' ? 'cc' : 'wb') as 'wb' | 'cc',
        }))
        .filter((f) => !existingFolder.has(f.id))
      if (add.length) {
        store.set(foldersAtom, [...store.get(foldersAtom), ...add])
        result.foldersAdded = add.length
      }
    }

    // 备份
    const rawBackups = readLocal<unknown[]>('chatbox_mod_backups')
    if (Array.isArray(rawBackups) && rawBackups.length) {
      store.set(modBackupsAtom, [...store.get(modBackupsAtom), ...(rawBackups.slice(0, 20) as ModBackup[])])
      result.backupsAdded = rawBackups.length
    }

    // 日志
    const rawLog = readLocal<unknown[]>('v284_log')
    if (Array.isArray(rawLog) && rawLog.length) {
      store.set(modLogAtom, [...store.get(modLogAtom), ...(rawLog.slice(0, 100) as ModLogEntry[])])
      result.logEntriesAdded = rawLog.length
    }

    // 持久化（写入官方存储）
    const { modSetItem } = await import('./storage')
    const { MOD_STORAGE_KEYS } = await import('./storage')
    await Promise.all([
      modSetItem(MOD_STORAGE_KEYS.worldBooks, store.get(worldBooksAtom)),
      modSetItem(MOD_STORAGE_KEYS.characterCards, store.get(characterCardsAtom)),
      modSetItem(MOD_STORAGE_KEYS.folders, store.get(foldersAtom)),
      modSetItem(MOD_STORAGE_KEYS.backups, store.get(modBackupsAtom)),
      modSetItem(MOD_STORAGE_KEYS.log, store.get(modLogAtom)),
    ])
    localStorage.setItem(MIGRATED_FLAG, '1')
    result.done = true
    return result
  } catch (e) {
    result.done = false
    result.error = String((e as Error)?.message ?? e)
    log.error('migrateV48Data failed', e)
    return result
  }
}

/** 查看是否已有 v48 旧数据 */
export function hasV48Data(): boolean {
  try {
    return ['WorldBooks', 'CharacterCards', 'chatbox_folders', 'chatbox_mod_backups', 'v284_log'].some((k) => {
      const v = localStorage.getItem(k)
      return !!v && v !== '[]' && v !== 'null'
    })
  } catch {
    return false
  }
}
