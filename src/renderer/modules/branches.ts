/**
 * Chatbox Mod 模块 —— 对话存档分支点（Bookmark Branches）
 *
 * 纯函数层：打点/取消、按会话过滤、删消息联动清理。
 * 存储与原子层在 store.ts（bookmarksAtom + MOD_STORAGE_KEYS.bookmarks）。
 */
import type { SessionBookmark } from './types'

/** 该会话的全部存档点 */
export function sessionBookmarks(bookmarks: SessionBookmark[], sessionId: string): SessionBookmark[] {
  return bookmarks.filter((b) => b && b.sessionId === sessionId)
}

/** 该会话中某消息是否已打点 */
export function isBookmarked(bookmarks: SessionBookmark[], sessionId: string, messageId: string): boolean {
  return bookmarks.some((b) => b && b.sessionId === sessionId && b.messageId === messageId)
}

/**
 * 打点/取消（toggle）：已打点 → 移除并返回 { added:false }；未打点 → 追加并返回 { added:true }。
 * 同一消息只能有一个存档点。
 */
export function toggleBookmark(
  bookmarks: SessionBookmark[],
  sessionId: string,
  messageId: string,
  preview: string,
  label?: string
): { list: SessionBookmark[]; added: boolean } {
  const existing = bookmarks.find((b) => b && b.sessionId === sessionId && b.messageId === messageId)
  if (existing) {
    return { list: bookmarks.filter((b) => b !== existing), added: false }
  }
  const next: SessionBookmark = {
    id: cryptoRandomId(),
    sessionId,
    messageId,
    timestamp: Date.now(),
    label,
    preview: String(preview ?? '').slice(0, 80),
  }
  return { list: [...bookmarks, next], added: true }
}

/** 删除单条消息 → 联动清理其存档点（不残留失效跳转） */
export function dropBookmarksForMessage(bookmarks: SessionBookmark[], sessionId: string, messageId: string): SessionBookmark[] {
  return bookmarks.filter((b) => !(b && b.sessionId === sessionId && b.messageId === messageId))
}

/** 多选删除多条消息 → 一并清理对应存档点 */
export function dropBookmarksForMessages(
  bookmarks: SessionBookmark[],
  sessionId: string,
  messageIds: string[]
): SessionBookmark[] {
  const ids = new Set(messageIds)
  return bookmarks.filter((b) => !(b && b.sessionId === sessionId && ids.has(b.messageId)))
}

/** 清空某会话全部存档点 */
export function clearSessionBookmarks(bookmarks: SessionBookmark[], sessionId: string): SessionBookmark[] {
  return bookmarks.filter((b) => !(b && b.sessionId === sessionId))
}

/** 会话内按时间升序排列（列表展示用） */
export function sortedSessionBookmarks(bookmarks: SessionBookmark[], sessionId: string): SessionBookmark[] {
  return sessionBookmarks(bookmarks, sessionId).sort((a, b) => a.timestamp - b.timestamp)
}

/** 消息在会话消息列表中的序号（第 N 条，1 起），用于列表展示 */
export function bookmarkMessageIndex(messageIds: string[], messageId: string): number {
  const idx = messageIds.indexOf(messageId)
  return idx >= 0 ? idx + 1 : 0
}

function cryptoRandomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 回退到时间戳随机串 */
  }
  return `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
