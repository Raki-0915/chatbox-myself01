/**
 * Chatbox Mod 模块 —— 群聊自动演（Auto-Play）
 *
 * 群聊模式（chatMode='group'）下，用户发一条消息后，AI 自动连续演 N 轮：
 * 第一轮由正常发送触发，之后每轮在上一条 AI 回复下方用 generateMore 续演，
 * 直到剩余轮数耗尽或用户手动停止（消息 finishReason === 'canceled'）。
 *
 * 本模块同时提供「点名发言」（Spotlight）：
 * 点击角色头像/名字 → 记录点名角色（一次性，注入时消费）→ 触发续演，
 * AI 本轮回复以被点名的角色带头开口。
 */
import { atom } from 'jotai'
import { getDefaultStore } from 'jotai'
import { groupSpotlightAtom } from './store'
import { rendererApplication } from '@/app/renderer-application'
import { generateMore } from '@/stores/session/generation'

/** 用户发 1 条 + 自动补几轮 = 连续演出总轮数 */
export const GROUP_AUTOPLAY_EXTRA_ROUNDS = 2
/** 每轮之间的停顿（毫秒），让演出有节奏感，避免刷屏 */
export const GROUP_AUTOPLAY_DELAY_MS = 1200

export interface GroupAutoPlayState {
  /** 触发自动演的会话 id */
  sessionId: string
  /** 还需自动续演的轮数（不含用户发送触发的第 1 轮） */
  remain: number
  /** 上一轮已触发续演的 AI 消息 id（防止重复触发） */
  lastTriggeredMsgId?: string
}

export const groupAutoPlayAtom = atom<GroupAutoPlayState>({ sessionId: '', remain: 0 })

/**
 * 点名发言入口：点击角色头像/名字后调用。
 * 设置点名角色 → 取会话最后一条消息 → 若不在生成中则触发续演（generateMore）。
 * 会话不存在 / 为空 / 正在生成时静默跳过（避免打断流式输出）。
 */
export function requestGroupSpotlightGenerate(sessionId: string | undefined, charName: string): void {
  if (!sessionId || !charName) return
  getDefaultStore().set(groupSpotlightAtom, charName)
  void (async () => {
    const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
    if (!session || session.messages.length === 0) return
    const last = session.messages[session.messages.length - 1]
    if (last.generating) return
    void generateMore(sessionId, last.id)
  })()
}

/** 用户发送成功后调度群聊自动演（sessionId 为空则取消） */
export function scheduleGroupAutoPlay(sessionId: string | undefined): void {
  if (!sessionId) {
    cancelGroupAutoPlay()
    return
  }
  getDefaultStore().set(groupAutoPlayAtom, {
    sessionId,
    remain: GROUP_AUTOPLAY_EXTRA_ROUNDS,
    lastTriggeredMsgId: undefined,
  })
}

/** 取消自动演（用户手动停止 / 切换模式 / 会话变更） */
export function cancelGroupAutoPlay(): void {
  getDefaultStore().set(groupAutoPlayAtom, { sessionId: '', remain: 0 })
}
