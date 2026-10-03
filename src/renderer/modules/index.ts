/**
 * Chatbox Mod 模块 —— 入口与运行时
 *
 * 初始化：加载数据 → 挂接"回复完成"事件（通过 TanStack Query cache 订阅，
 * 非轮询）→ 按需触发自动剧情更新。
 *
 * 完成判定：会话最后一条 assistant 消息从 generating=true 变为已完成
 * （generating 清除且内容非空），且内容与上次触发时不同。
 */
import { getDefaultStore } from 'jotai'
import NiceModal from '@ebay/nice-modal-react'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { QueryKeys } from '@chatbox/react/query'
import type { Session } from '@shared/types'
import { maybeAutoUpdateWorldBooks } from './auto-update'
import { getBinding } from './session'
import { loadModStore, modSettingsAtom, modLog } from './store'

const log = getLogger('mod-init')

/** 每个会话的上次完成状态（防止同一回复重复触发） */
const lastFinished = new Map<string, { msgId: string; len: number; t: number }>()
/** 同一会话两次更新最小间隔（毫秒） */
const MIN_INTERVAL = 60_000

function isAssistantTextMsg(m: Session['messages'][number]): boolean {
  return m?.role === 'assistant' && Array.isArray(m.contentParts) && m.contentParts.some((p) => p.type === 'text' && p.text)
}

function isStillGenerating(m: Session['messages'][number]): boolean {
  return Boolean((m as { generating?: boolean }).generating)
}

/** 检查一次缓存更新：是否某会话刚完成一次回复 */
async function onSessionCacheUpdated(sid: string, session: Session | null | undefined): Promise<void> {
  if (!session?.messages?.length) return
  const store = getDefaultStore()
  const settings = store.get(modSettingsAtom)
  if (!settings.autoUpdateEnabled) return

  // 只有装载了世界书或人物卡的会话才触发
  const binding = await getBinding(sid)
  if (binding.worldBookIds.length === 0 && binding.characterCardIds.length === 0) return

  // 最后一条有内容的 assistant 消息
  let last: Session['messages'][number] | undefined
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (isAssistantTextMsg(session.messages[i])) {
      last = session.messages[i]
      break
    }
  }
  if (!last) return
  if (isStillGenerating(last)) return // 还在生成中

  const content = (last.contentParts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('')
  if (!content.trim()) return

  const prev = lastFinished.get(sid)
  const now = Date.now()
  if (prev && prev.msgId === last.id && prev.len === content.length && now - prev.t < MIN_INTERVAL) {
    return // 同一回复，已触发过
  }
  lastFinished.set(sid, { msgId: last.id, len: content.length, t: now })

  // 延迟一小段，等消息状态完全落盘
  setTimeout(() => {
    void maybeAutoUpdateWorldBooks(sid, {
      force: false,
      onPreview: (diff) => NiceModal.show('mod-update-preview', { diff }),
    }).then((r) => {
      if (!r.ok && r.error && r.error !== '已有更新任务进行中') {
        log.warn(`auto-update for ${sid} skipped:`, r.error)
      } else if (r.ok) {
        void modLog('auto-update-triggered', r, sid)
      }
    })
  }, 500)
}

/** 初始化模块（应用启动时调用一次） */
export function initChatboxMod(): void {
  void loadModStore().then(() => {
    // v48 旧数据自动迁移（幂等，只跑一次）
    void import('./migration').then(({ migrateV48Data, hasV48Data }) => {
      if (!hasV48Data()) return
      void migrateV48Data().then((r) => {
        if (r.done && (r.worldBooksAdded || r.characterCardsAdded || r.foldersAdded || r.backupsAdded)) {
          log.info(`[mod] v48 data migrated: wb+${r.worldBooksAdded} cc+${r.characterCardsAdded} folders+${r.foldersAdded} backups+${r.backupsAdded}`)
        } else if (!r.done) {
          log.warn(`[mod] v48 migration failed: ${r.error}`)
        }
      })
    })
  })

  // 响应式订阅 session 查询缓存：会话数据每次变化都会收到事件
  try {
    const queryClient = rendererApplication.queryClient
    const cache = queryClient.getQueryCache()
    cache.subscribe((event) => {
      try {
        if (event.type !== 'updated') return
        const key = event.query.queryKey
        if (!Array.isArray(key) || key[0] !== QueryKeys.ChatSession('')[0]) return
        const sid = key[1]
        if (typeof sid !== 'string' || !sid) return
        const data = event.query.state.data as Session | null | undefined
        if (!data) return
        void onSessionCacheUpdated(sid, data)
      } catch (e) {
        // 侦听器内部错误不应影响官方流程
        log.warn('mod cache listener error', e)
      }
    })
    log.info('chatbox mod initialized')
  } catch (e) {
    log.error('chatbox mod init failed', e)
  }
}
