import { isThreadHistoryAvailable, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Button, Flex } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Session } from '@shared/types'
import {
  IconClearAll,
  IconCode,
  IconCopy,
  IconDeviceFloppy,
  IconDots,
  IconHistory,
  IconId,
  IconSearch,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { parseChatImport, toSessionMessages } from '@/modules/chat-import'
import { useIsLargeScreen, useIsSmallScreen } from '@/hooks/useScreenChange'
import { copyToClipboard } from '@/packages/navigator'
import { confirmSessionDeletion } from '@/presentation/session/session-deletion-confirmation'
import { router } from '@/router'
import * as atoms from '@/stores/atoms'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import { clear as clearSession, copyAndSwitchSession, deleteSession } from '@/stores/session/crud'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu from '../ActionMenu'
import { ScalableIcon } from '../common/ScalableIcon'
import Broom from '../icons/Broom'
import LayoutExpand from '../icons/LayoutExpand'
import LayoutShrink from '../icons/LayoutShrink'

/**
 * 顶部标题工具栏（右侧）
 * @returns
 */
export default function Toolbar({ session }: { session: Session }) {
  const { t } = useTranslation()
  const sessionId = session.id
  const isSmallScreen = useIsSmallScreen()
  const isLargeScreen = useIsLargeScreen()

  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const setThreadHistoryDrawerOpen = useSetAtom(atoms.showThreadHistoryDrawerAtom)
  const widthFull = useUIStore((s) => s.widthFull)
  const setWidthFull = useUIStore((s) => s.setWidthFull)
  const agentModeEntry = useSessionAgentMode(sessionId)
  const showThreadHistory = isThreadHistoryAvailable(session, resolveSessionMode(agentModeEntry.value))

  const handleExportAndSave = () => {
    NiceModal.show('export-chat')
  }
  const handleSessionClean = () => {
    void clearSession(sessionId)
  }
  const handleSessionDelete = async () => {
    if (!(await confirmSessionDeletion(sessionId))) {
      return
    }
    try {
      await deleteSession(sessionId)
      router.navigate({ to: '/', replace: true })
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const handleViewSessionJson = useCallback(async () => {
    const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
    if (session) {
      await NiceModal.show('json-viewer', { title: t('Session Raw JSON'), data: session })
    }
  }, [sessionId, t])

  // Chatbox Mod: 导入聊天记录（支持官方导出的 .md/.txt、通用 .json/.jsonl，含酒馆 SillyTavern 聊天记录）
  const handleImportChat = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.jsonl,.md,.markdown,.txt,text/plain,application/json'
    input.style.display = 'none'
    input.onchange = () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return
      void (async () => {
        try {
          const text = await file.text()
          const parsed = parseChatImport(text, file.name)
          if (!parsed.ok || parsed.messages.length === 0) {
            toastActions.add(parsed.error ?? '导入失败：未解析到任何消息', 4000)
            return
          }
          const messages = toSessionMessages(parsed.messages)
          const baseName = parsed.name || file.name.replace(/\.(json|jsonl|md|markdown|txt)$/i, '') || '导入的对话'
          const session = await rendererApplication.sessions.createSession({
            name: baseName,
            messages,
            type: 'chat',
            threadName: parsed.name || '',
            settings: {},
          })
          if (!session) {
            toastActions.add('导入失败：创建会话失败', 4000)
            return
          }
          toastActions.add(`已导入 ${messages.length} 条消息`, 2500)
          const { navigateToDynamicPath } = await import('@/router')
          navigateToDynamicPath({ to: `/session/${session.id}` })
        } catch (e) {
          toastActions.add(`导入失败：${String(e)}`, 4000)
        }
      })()
    }
    document.body.appendChild(input)
    input.click()
  }, [t])

  const handleCopySession = useCallback(async () => {
    const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
    if (session) {
      await copyAndSwitchSession(session)
    }
  }, [sessionId])

  const handleCopySessionId = useCallback(() => {
    copyToClipboard(sessionId)
    toastActions.add(t('copied to clipboard'), 2000)
  }, [sessionId, t])

  return !isSmallScreen ? (
    <Flex align="center" gap="md" className="controls">
      {!isSmallScreen ? (
        <Button
          h={28}
          px="xs"
          radius="lg"
          variant="outline"
          color="chatbox-tertiary"
          data-testid={TestId.session.searchTrigger}
          leftSection={<ScalableIcon icon={IconSearch} size={16} strokeWidth={1.8} />}
          className="border-chatbox-border-primary"
          classNames={{
            label: 'px-1',
          }}
          onClick={() => setOpenSearchDialog(true)}
        >
          {t('Search')}...
        </Button>
      ) : (
        <ActionIcon
          variant="subtle"
          size={28}
          color="chatbox-secondary"
          data-testid={TestId.session.searchTrigger}
          onClick={() => setOpenSearchDialog(true)}
        >
          <IconSearch strokeWidth={1.8} />
        </ActionIcon>
      )}

      <ActionMenu
        position="bottom-end"
        contentTestId={TestId.session.headerMenu}
        items={[
          ...(isLargeScreen
            ? [
                {
                  text: widthFull ? t('Standard Width') : t('Full Width'),
                  icon: widthFull ? LayoutExpand : LayoutShrink,
                  testId: TestId.session.widthToggle,
                  onClick: () => setWidthFull(!widthFull),
                },
              ]
            : []),
          ...(showThreadHistory
            ? [
                {
                  text: t('Thread History'),
                  icon: IconHistory,
                  testId: TestId.session.threadHistory,
                  onClick: () => setThreadHistoryDrawerOpen(true),
                },
              ]
            : []),
          ...(isLargeScreen || showThreadHistory
            ? [
                {
                  divider: true as const,
                },
              ]
            : []),
          {
            text: t('Duplicate Conversation'),
            icon: IconCopy,
            testId: TestId.session.duplicate,
            onClick: handleCopySession,
          },
          {
            text: t('Copy Conversation ID'),
            icon: IconId,
            onClick: handleCopySessionId,
          },
          {
            text: t('Export Chat'),
            icon: IconDeviceFloppy,
            testId: TestId.session.export,
            onClick: handleExportAndSave,
          },
          {
            text: '导入聊天记录',
            icon: IconUpload,
            testId: 'import-chat-trigger',
            onClick: handleImportChat,
          },
          ...(process.env.NODE_ENV === 'development'
            ? [
                {
                  text: t('View Session JSON'),
                  icon: IconCode,
                  onClick: handleViewSessionJson,
                },
              ]
            : []),
          {
            divider: true,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Clear All Messages'),
            icon: Broom,
            color: 'chatbox-primary',
            testId: TestId.session.clearMessages,
            confirmTestId: TestId.session.clearMessagesConfirm,
            onClick: handleSessionClean,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Delete Current Session'),
            icon: IconTrash,
            color: 'chatbox-primary',
            testId: TestId.session.delete,
            confirmTestId: TestId.session.deleteConfirm,
            onClick: handleSessionDelete,
          },
        ]}
      >
        <ActionIcon variant="subtle" size={28} color="chatbox-secondary" data-testid={TestId.session.headerMenuTrigger}>
          <IconDots strokeWidth={1.8} />
        </ActionIcon>
      </ActionMenu>
    </Flex>
  ) : (
    <Flex align="center" gap="xs">
      <ActionIcon
        variant="subtle"
        size={24}
        color="chatbox-secondary"
        data-testid={TestId.session.searchTrigger}
        onClick={() => setOpenSearchDialog(true)}
      >
        <IconSearch strokeWidth={1.8} />
      </ActionIcon>
      <ActionMenu
        position="bottom-end"
        contentTestId={TestId.session.headerMenu}
        items={[
          ...(showThreadHistory
            ? [
                {
                  text: t('Thread History'),
                  icon: IconHistory,
                  testId: TestId.session.threadHistory,
                  onClick: () => setThreadHistoryDrawerOpen(true),
                },
              ]
            : []),
          {
            text: t('Duplicate Conversation'),
            icon: IconCopy,
            testId: TestId.session.duplicate,
            onClick: handleCopySession,
          },
          {
            text: t('Copy Conversation ID'),
            icon: IconId,
            onClick: handleCopySessionId,
          },
          {
            text: t('Export Chat'),
            icon: IconDeviceFloppy,
            testId: TestId.session.export,
            onClick: handleExportAndSave,
          },
          {
            text: '导入聊天记录',
            icon: IconUpload,
            testId: 'import-chat-trigger',
            onClick: handleImportChat,
          },
          ...(process.env.NODE_ENV === 'development'
            ? [
                {
                  text: t('View Session JSON'),
                  icon: IconCode,
                  onClick: handleViewSessionJson,
                },
              ]
            : []),
          {
            divider: true,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Clear All Messages'),
            icon: IconClearAll,
            color: 'chatbox-primary',
            testId: TestId.session.clearMessages,
            confirmTestId: TestId.session.clearMessagesConfirm,
            onClick: handleSessionClean,
          },
          {
            doubleCheck: {
              color: 'chatbox-error',
            },
            text: t('Delete Current Session'),
            icon: IconTrash,
            color: 'chatbox-primary',
            testId: TestId.session.delete,
            confirmTestId: TestId.session.deleteConfirm,
            onClick: handleSessionDelete,
          },
        ]}
      >
        <ActionIcon variant="subtle" size={24} color="chatbox-secondary" data-testid={TestId.session.headerMenuTrigger}>
          <IconDots strokeWidth={1.8} />
        </ActionIcon>
      </ActionMenu>
    </Flex>
  )
}
