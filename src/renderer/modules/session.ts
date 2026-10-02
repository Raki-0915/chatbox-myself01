/**
 * Chatbox Mod 模块 —— 会话装载
 *
 * 世界书/人物卡与目标会话的绑定：读取/写入会话 settings.worldBookIds / characterCardIds。
 * 字段定义在官方 SessionSettingsSchema 的扩展中（见 settings-schema.ts 改动）。
 */
import { getLogger } from '@/lib/utils'
import { rendererApplication } from '@/app/renderer-application'
import { getSessionSettings } from '@/stores/session/session-settings'

const log = getLogger('mod-session')

/** 会话装载状态 */
export interface ModBinding {
  worldBookIds: string[]
  characterCardIds: string[]
  /** 对话级自动更新开关（未设置时回退全局 modSettings.autoUpdateEnabled） */
  autoUpdateEnabled?: boolean
}

const EMPTY: ModBinding = { worldBookIds: [], characterCardIds: [] }

/** 读取会话当前装载（无绑定返回空） */
export async function getBinding(sessionId: string): Promise<ModBinding> {
  try {
    const settings = await getSessionSettings(sessionId)
    return {
      worldBookIds: Array.isArray(settings.worldBookIds) ? settings.worldBookIds : [],
      characterCardIds: Array.isArray(settings.characterCardIds) ? settings.characterCardIds : [],
      autoUpdateEnabled: settings.autoUpdateEnabled,
    }
  } catch (e) {
    log.warn(`getBinding(${sessionId}) failed`, e)
    return { ...EMPTY }
  }
}

/** 写入会话装载 */
export async function setBinding(sessionId: string, binding: ModBinding): Promise<void> {
  await rendererApplication.sessions.updateSession(sessionId, (session) => {
    if (!session) throw new Error(`Session ${sessionId} not found`)
    return {
      ...session,
      settings: {
        ...session.settings,
        worldBookIds: binding.worldBookIds ?? [],
        characterCardIds: binding.characterCardIds ?? [],
        autoUpdateEnabled: binding.autoUpdateEnabled,
      },
    }
  })
}

/** 追加装载（避免重复） */
export async function addBindingItems(
  sessionId: string,
  patch: { worldBookIds?: string[]; characterCardIds?: string[] }
): Promise<ModBinding> {
  const cur = await getBinding(sessionId)
  const next: ModBinding = {
    worldBookIds: [...new Set([...cur.worldBookIds, ...(patch.worldBookIds ?? [])])],
    characterCardIds: [...new Set([...cur.characterCardIds, ...(patch.characterCardIds ?? [])])],
  }
  await setBinding(sessionId, next)
  return next
}

/** 全量替换装载 */
export async function replaceBinding(
  sessionId: string,
  patch: { worldBookIds?: string[]; characterCardIds?: string[] }
): Promise<ModBinding> {
  const cur = await getBinding(sessionId)
  const next: ModBinding = {
    worldBookIds: patch.worldBookIds ?? cur.worldBookIds,
    characterCardIds: patch.characterCardIds ?? cur.characterCardIds,
  }
  await setBinding(sessionId, next)
  return next
}

/** 清空装载 */
export async function clearBinding(sessionId: string): Promise<void> {
  await setBinding(sessionId, { worldBookIds: [], characterCardIds: [] })
}

/** 会话列表（供 UI 选择目标会话） */
export async function listSessionsMeta(): Promise<SessionMetaLike[]> {
  try {
    return await rendererApplication.sessionQueryBridge.listSessionsMeta()
  } catch (e) {
    log.warn('listSessionsMeta failed', e)
    return []
  }
}

export interface SessionMetaLike {
  id: string
  name?: string | null
  [k: string]: unknown
}
