/**
 * Chatbox Mod —— 自动更新预览确认弹窗
 *
 * 模型算出的世界书/人物卡差异（新增/更新/删除）先展示给用户，
 * 用户确认后才写回。注册名 'mod-update-preview'，返回 Promise<boolean>。
 */
import { useState } from 'react'
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Badge, Box, Button, Divider, Group, Modal, ScrollArea, Stack, Text } from '@mantine/core'
import type { AutoUpdateDiff } from '../modules/auto-update'

function EntryList({ title, color, items, getLabel }: { title: string; color: string; items: unknown[]; getLabel: (x: Record<string, unknown>) => string }) {
  if (items.length === 0) return null
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge size="xs" color={color}>{title}</Badge>
        <Text size="xs" c="dimmed">{items.length} 条</Text>
      </Group>
      <Stack gap={3}>
        {items.slice(0, 20).map((raw, i) => {
          const it = raw as Record<string, unknown>
          const label = getLabel(it)
          const extra = String(it.content ?? it.backgroundStory ?? '').slice(0, 60)
          return (
            <Text key={i} size="xs" style={{ lineHeight: 1.6 }}>
              <Text span c="green" fw={600}>{label}</Text>
              {extra ? <Text span c="dimmed"> — {extra}{String(it.content ?? it.backgroundStory ?? '').length > 60 ? '…' : ''}</Text> : null}
            </Text>
          )
        })}
        {items.length > 20 ? <Text size="xs" c="dimmed">… 其余 {items.length - 20} 条省略</Text> : null}
      </Stack>
    </Box>
  )
}

function RemoveList({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge size="xs" color="red">{title}</Badge>
        <Text size="xs" c="dimmed">{names.length} 条</Text>
      </Group>
      <Stack gap={3}>
        {names.slice(0, 20).map((n, i) => (
          <Text key={i} size="xs"><Text span c="red" fw={600}>{n}</Text></Text>
        ))}
        {names.length > 20 ? <Text size="xs" c="dimmed">… 其余 {names.length - 20} 条省略</Text> : null}
      </Stack>
    </Box>
  )
}

const ModUpdatePreview = NiceModal.create(({ diff }: { diff: AutoUpdateDiff }) => {
  const modal = useModal()
  const [busy, setBusy] = useState(false)
  const wbName = (x: Record<string, unknown>) => String(x.name ?? '（未命名）')
  const ccName = (x: Record<string, unknown>) => String(x.name ?? '（未命名）')

  const total =
    diff.wb.add.length + diff.wb.update.length + diff.wb.remove.length +
    diff.cc.add.length + diff.cc.update.length + diff.cc.remove.length

  return (
    <Modal opened onClose={() => modal.resolve(false)} title="更新预览 — 确认是否应用" size="lg">
      {total === 0 ? (
        <Text c="dimmed" size="sm">模型未提出任何变更，无需更新。</Text>
      ) : (
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            以下为模型根据近期对话提出的设定变更，确认后才会写入世界书 / 人物卡（应用前会自动备份快照）。
          </Text>
          <ScrollArea.Autosize mah={420}>
            <Stack gap="sm">
              {diff.wb.add.length + diff.wb.update.length + diff.wb.remove.length > 0 && <Divider label="世界书" labelPosition="left" />}
              <EntryList title="新增" color="green" items={diff.wb.add} getLabel={wbName} />
              <EntryList title="更新" color="blue" items={diff.wb.update} getLabel={wbName} />
              <RemoveList title="删除" names={diff.wb.remove} />
              {diff.cc.add.length + diff.cc.update.length + diff.cc.remove.length > 0 && <Divider label="人物卡" labelPosition="left" />}
              <EntryList title="新增" color="green" items={diff.cc.add} getLabel={ccName} />
              <EntryList title="更新" color="blue" items={diff.cc.update} getLabel={ccName} />
              <RemoveList title="删除" names={diff.cc.remove} />
            </Stack>
          </ScrollArea.Autosize>
          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" onClick={() => modal.resolve(false)} disabled={busy}>取消</Button>
            <Button color="chatbox-brand" onClick={() => { setBusy(true); modal.resolve(true) }} disabled={busy}>
              {busy ? '应用更新…' : '确认更新'}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
})

export default ModUpdatePreview
