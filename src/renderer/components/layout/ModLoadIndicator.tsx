/**
 * Chatbox Mod —— 对话页装载指示条（输入框上方）
 *
 * 当前对话装载了世界书/人物卡，或开启了自动更新时，显示一行指示。
 * 自动更新为对话级：优先会话 settings.autoUpdateEnabled，未设置时回退全局 modSettings.autoUpdateEnabled。
 * 数据：session.ts getBinding + modSettingsAtom
 */
import { Box, Text } from '@mantine/core'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { IconBook2 } from '@tabler/icons-react'
import { getBinding } from '@/modules/session'
import { modSettingsAtom } from '@/modules/store'

export default function ModLoadIndicator(props: { sessionId: string }) {
  const { sessionId } = props
  const modSettings = useAtomValue(modSettingsAtom)
  const [wbCount, setWbCount] = useState(0)
  const [ccCount, setCcCount] = useState(0)
  const [autoUpdate, setAutoUpdate] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void getBinding(sessionId).then((b) => {
      if (!alive) return
      setWbCount(b.worldBookIds.length)
      setCcCount(b.characterCardIds.length)
      setAutoUpdate(b.autoUpdateEnabled)
    })
    return () => {
      alive = false
    }
  }, [sessionId])

  const autoOn = autoUpdate ?? modSettings.autoUpdateEnabled
  const total = wbCount + ccCount
  if (total === 0 && !autoOn) return null

  const parts: string[] = []
  if (total > 0) parts.push(`已装载 ${wbCount} 条世界书 · ${ccCount} 张人物卡`)
  parts.push(`自动更新${autoOn ? '已开启' : '未开启'}`)

  return (
    <Box
      px="md"
      py={4}
      style={{
        background: 'var(--chatbox-background-brand-secondary, #eff6ff)',
        borderRadius: 8,
        border: '1px solid var(--chatbox-border-primary, #eef0f3)',
      }}
    >
      <Text size="xs" c="chatbox-brand" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconBook2 size={13} />
        <span style={{ fontWeight: 600 }}>创作资料</span>
        <span style={{ color: 'var(--chatbox-text-secondary, #64748b)', fontWeight: 400 }}>{parts.join(' ｜ ')}</span>
      </Text>
    </Box>
  )
}
