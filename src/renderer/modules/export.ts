/**
 * Chatbox Mod 模块 —— 数据导出
 *
 * 把世界书/人物卡/日志/备份导出为 JSON 文件。
 * 复用官方 platform.exporter（web 下载 / mobile SAF 系统分享 / desktop 文件存储），
 * 不再像 v48 那样手工调 Filesystem+Share。
 */
import { getDefaultStore } from 'jotai'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { characterCardsAtom, foldersAtom, modBackupsAtom, modLogAtom, modSettingsAtom, worldBooksAtom } from './store'

const log = getLogger('mod-export')

export interface ModExportPayload {
  format: 'chatbox-mod-export'
  version: 1
  exportedAt: number
  settings: unknown
  folders: unknown
  worldBooks: unknown
  characterCards: unknown
  log: unknown
  backups: unknown
}

/** 生成完整导出数据 */
export function buildExportPayload(): ModExportPayload {
  const store = getDefaultStore()
  return {
    format: 'chatbox-mod-export',
    version: 1,
    exportedAt: Date.now(),
    settings: store.get(modSettingsAtom),
    folders: store.get(foldersAtom),
    worldBooks: store.get(worldBooksAtom),
    characterCards: store.get(characterCardsAtom),
    log: store.get(modLogAtom),
    backups: store.get(modBackupsAtom),
  }
}

/** 导出为 JSON 文件（复用官方 exporter，跨平台） */
export async function exportModData(filename = 'chatbox-mod-data.json'): Promise<{ ok: boolean; error?: string }> {
  try {
    const json = JSON.stringify(buildExportPayload(), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    await platform.exporter.exportBlob(filename, blob, 'utf8')
    return { ok: true }
  } catch (e) {
    log.error('exportModData failed', e)
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
}

/** 导入：整包替换（先备份旧数据再覆盖） */
export async function importModData(json: string): Promise<{ ok: boolean; added?: number; error?: string }> {
  try {
    const parsed = JSON.parse(json) as Partial<ModExportPayload>
    if (parsed.format !== 'chatbox-mod-export') {
      return { ok: false, error: '不是 Chatbox Mod 导出文件' }
    }
    const { importModPayload } = await import('./store')
    await importModPayload(parsed)
    return { ok: true }
  } catch (e) {
    log.error('importModData failed', e)
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
}
