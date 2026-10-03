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
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
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

/** 浏览器环境是否支持 File System Access API（可弹系统“另存为”，选文件名+目录） */
function canUseSaveFilePicker(): boolean {
  try {
    return typeof window !== 'undefined' && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
  } catch {
    return false
  }
}

/**
 * 带“编辑文件名 + 选择保存路径”的 JSON 导出。
 * - Web 浏览器：优先 File System Access API（showSaveFilePicker）→ 弹出系统“另存为”对话框，可编辑文件名并选择保存目录；
 *   浏览器不支持该 API 时回退为普通下载（文件名用传入值）。
 * - Android / 桌面：复用 platform.exporter.exportBlob → SAF 系统保存对话框 / 桌面原生对话框，天然支持改文件名和选位置。
 */
export async function exportJsonWithPath(
  defaultName: string,
  blob: Blob,
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  const isWeb = CHATBOX_BUILD_PLATFORM === 'web'
  if (isWeb && canUseSaveFilePicker()) {
    try {
      const w = window as unknown as {
        showSaveFilePicker: (opts: {
          suggestedName?: string
          types?: Array<{ description?: string; accept: Record<string, string[]> }>
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>
            close: () => Promise<void>
          }>
        }>
      }
      const handle = await w.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{ description: 'JSON 文件', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return { ok: true }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { ok: true, canceled: true } // 用户取消另存为
      // 其他错误：回退到平台默认导出
    }
  }
  try {
    await platform.exporter.exportBlob(defaultName, blob, 'utf8')
    return { ok: true }
  } catch (e) {
    log.error('exportJsonWithPath failed', e)
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
