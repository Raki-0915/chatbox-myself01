/**
 * Chatbox Mod —— 对话存档分支点列表弹窗
 *
 * 展示当前会话全部存档点（第 N 条消息 + 内容预览 + 时间），
 * 点击 → 滚动定位该消息并高亮（浅蓝）；支持单条删除/清空。
 */
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { ActionIcon, Box, Button, Divider, Group, Modal, ScrollArea, Stack, Text } from '@mantine/core'
import { IconGitBranch, IconTrash } from '@tabler/icons-react'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'
import type { Session } from '@shared/types'
import { sortedSessionBookmarks, bookmarkMessageIndex } from '@/modules/branches'
import {
  bookmarksAtom,
  clearSessionBookmarksStore,
  removeBookmarksByMessageIds,
  setBookmarkJumpRequest,
} from '@/modules/store'

const BookmarkListModal = NiceModal.create(({ session }: { session?: Session }) => {
  const modal = useModal()
  const bookmarks = useAtomValue(bookmarksAtom)
  const sessionId = session?.id ?? ''
  const messageIds = useMemo(() => (session ? session.messages.map((m) => m.id) : []), [session])

  const list = useMemo(() => sortedSessionBookmarks(bookmarks, sessionId), [bookmarks, sessionId])

  useEffect(() => {
    // 弹窗关闭时清掉未消费的跳转请求
    return () => {
      void setBookmarkJumpRequest(null)
    }
  }, [])

  const onJump = useCallback(
    (messageId: string) => {
      if (!sessionId) return
      void setBookmarkJumpRequest({ sessionId, messageId })
      modal.hide()
    },
    [sessionId, modal]
  )

  const onRemoveOne = useCallback(
    async (messageId: string) => {
      if (!sessionId) return
      await removeBookmarksByMessageIds(sessionId, [messageId])
    },
    [sessionId]
  )

  const onClearAll = useCallback(async () => {
    if (!sessionId) return
    await clearSessionBookmarksStore(sessionId)
  }, [sessionId])

  return (
    <Modal opened onClose={modal.hide} title="存档分支点" size="lg" centered>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          共 {list.length} 个存档点。点击一条跳转到对应消息并从该点继续；删除消息时对应存档点会自动清理。
        </Text>
        {list.length === 0 ? (
          <Box style={{ border: '1px dashed #d0d0d0', borderRadius: 6, padding: '12px', background: '#fafafa' }}>
            <Text size="xs" c="dimmed">
              暂无存档点。在对话中长按任意消息 →「存为分支点」，即可在这里回看与跳转。
            </Text>
          </Box>
        ) : (
          <ScrollArea.Autosize mah={380} type="auto">
            <Stack gap={6}>
              {list.map((b) => {
                const idx = bookmarkMessageIndex(messageIds, b.messageId)
                return (
                  <Box
                    key={b.id}
                    style={{
                      border: '1px solid #e0e0e0',
                      borderRadius: 6,
                      padding: '6px 10px',
                      background: '#fff',
                      cursor: 'pointer',
                    }}
                    onClick={() => onJump(b.messageId)}
                  >
                    <Group gap={6} wrap="nowrap" align="center">
                      <IconGitBranch size={13} style={{ color: 'var(--mantine-color-chatbox-brand-filled)', flexShrink: 0 }} />
                      <Text size="xs" fw={600} className="flex-1 min-w-0 truncate">
                        {idx > 0 ? `第 ${idx} 条` : '（消息已不在当前列表）'}
                        {b.label ? ` · ${b.label}` : ''}
                      </Text>
                      <Text size="xs" c="dimmed" className="shrink-0">
                        {new Date(b.timestamp).toLocaleString()}
                      </Text>
                      <ActionIcon
                        size="sm"
                        color="red"
                        variant="subtle"
                        onClick={(e) => {
                          e.stopPropagation()
                          void onRemoveOne(b.messageId)
                        }}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                    <Text size="xs" lineClamp={2} c="dimmed" mt={2}>
                      {b.preview || '（无内容预览）'}
                    </Text>
                  </Box>
                )
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}
        <Divider />
        <Group justify="space-between">
          <Button size="compact-xs" variant="subtle" color="red" disabled={!list.length} onClick={() => void onClearAll()}>
            清空本会话存档点
          </Button>
          <Button size="compact-xs" onClick={modal.hide}>
            关闭
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
})

export default BookmarkListModal
