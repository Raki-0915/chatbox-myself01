/**
 * Chatbox Mod —— 自动更新预览确认弹窗（逐条勾选）
 *
 * 模型算出的世界书/人物卡差异（新增/更新/删除）逐条列出，
 * 用户勾选要应用的条目，确认后返回「勾选后的差异 diff」；取消返回 null。
 * 注册名 'mod-update-preview'。
 */
import { useMemo, useState } from 'react'
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Badge, Box, Button, Checkbox, Divider, Group, Modal, Stack, Text } from '@mantine/core'
import type { AutoUpdateDiff } from '../modules/auto-update'

type Sel = { add: Set<number>; update: Set<number>; remove: Set<string> }
type SelAll = { wb: Sel; cc: Sel }

function newSel(add: number, update: number, remove: string[]): Sel {
  return {
    add: new Set(Array.from({ length: add }, (_, i) => i)),
    update: new Set(Array.from({ length: update }, (_, i) => i)),
    remove: new Set(remove),
  }
}

/** 对象条目列表（新增/更新）：每条 checkbox + 名称 + 内容摘要 */
function PickEntryList({
  title, color, items, getLabel, selected, onToggle,
}: {
  title: string
  color: string
  items: Array<Record<string, unknown>>
  getLabel: (x: Record<string, unknown>) => string
  selected: Set<number>
  onToggle: (idx: number) => void
}) {
  if (items.length === 0) return null
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge size="xs" color={color}>{title}</Badge>
        <Text size="xs" c="dimmed">{selected.size}/{items.length} 条</Text>
      </Group>
      <Stack gap={4}>
        {items.slice(0, 20).map((raw, i) => {
          const it = raw as Record<string, unknown>
          const label = getLabel(it)
          const extra = String(it.content ?? it.backgroundStory ?? '')
          return (
            <Checkbox
              key={i}
              size="xs"
              checked={selected.has(i)}
              onChange={() => onToggle(i)}
              label={(
                <Box style={{ lineHeight: 1.5, paddingTop: 2 }}>
                  <Text size="xs" fw={600}>{label}</Text>
                  {extra ? (
                    <Text size="xs" c="dimmed" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {extra.slice(0, 60)}{extra.length > 60 ? '…' : ''}
                    </Text>
                  ) : null}
                </Box>
              )}
            />
          )
        })}
        {items.length > 20 ? <Text size="xs" c="dimmed">… 其余 {items.length - 20} 条省略（未展示条目默认不应用，如需应用请分次更新）</Text> : null}
      </Stack>
    </Box>
  )
}

/** 删除条目列表（名称数组）：每条 checkbox */
function PickRemoveList({
  title, names, selected, onToggle,
}: {
  title: string
  names: string[]
  selected: Set<string>
  onToggle: (name: string) => void
}) {
  if (names.length === 0) return null
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge size="xs" color="red">{title}</Badge>
        <Text size="xs" c="dimmed">{selected.size}/{names.length} 条</Text>
      </Group>
      <Stack gap={4}>
        {names.slice(0, 20).map((n, i) => (
          <Checkbox
            key={i}
            size="xs"
            checked={selected.has(n)}
            onChange={() => onToggle(n)}
            label={<Text size="xs" fw={600}>{n}</Text>}
          />
        ))}
        {names.length > 20 ? <Text size="xs" c="dimmed">… 其余 {names.length - 20} 条省略</Text> : null}
      </Stack>
    </Box>
  )
}

const ModUpdatePreview = NiceModal.create(({ diff }: { diff: AutoUpdateDiff }) => {
  const modal = useModal()
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<SelAll>(() => ({
    wb: newSel(diff.wb.add.length, diff.wb.update.length, diff.wb.remove),
    cc: newSel(diff.cc.add.length, diff.cc.update.length, diff.cc.remove),
  }))
  const wbName = (x: Record<string, unknown>) => String(x.name ?? '（未命名）')
  const ccName = (x: Record<string, unknown>) => String(x.name ?? '（未命名）')

  const total = diff.wb.add.length + diff.wb.update.length + diff.wb.remove.length +
    diff.cc.add.length + diff.cc.update.length + diff.cc.remove.length
  const selTotal = sel.wb.add.size + sel.wb.update.size + sel.wb.remove.size +
    sel.cc.add.size + sel.cc.update.size + sel.cc.remove.size
  const allSelected = selTotal === total

  const toggle = (group: 'wb' | 'cc', kind: 'add' | 'update', idx: number) => {
    setSel((s) => {
      const next = new Set(s[group][kind])
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return { ...s, [group]: { ...s[group], [kind]: next } }
    })
  }
  const toggleRemove = (group: 'wb' | 'cc', name: string) => {
    setSel((s) => {
      const next = new Set(s[group].remove)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return { ...s, [group]: { ...s[group], remove: next } }
    })
  }
  const toggleAll = () => {
    if (allSelected) {
      setSel({ wb: { add: new Set(), update: new Set(), remove: new Set() }, cc: { add: new Set(), update: new Set(), remove: new Set() } })
    } else {
      setSel({
        wb: newSel(diff.wb.add.length, diff.wb.update.length, diff.wb.remove),
        cc: newSel(diff.cc.add.length, diff.cc.update.length, diff.cc.remove),
      })
    }
  }

  // 勾选结果 → 过滤后的差异
  const apply = () => {
    if (busy || selTotal === 0) return
    setBusy(true)
    const pick = <T,>(arr: T[], s: Set<number>) => arr.filter((_, i) => s.has(i))
    const result: AutoUpdateDiff = {
      wb: {
        add: pick(diff.wb.add, sel.wb.add),
        update: pick(diff.wb.update, sel.wb.update),
        remove: diff.wb.remove.filter((n) => sel.wb.remove.has(n)),
      },
      cc: {
        add: pick(diff.cc.add, sel.cc.add),
        update: pick(diff.cc.update, sel.cc.update),
        remove: diff.cc.remove.filter((n) => sel.cc.remove.has(n)),
      },
    }
    modal.resolve(result)
    modal.remove()
  }
  const cancel = () => {
    if (busy) return
    modal.resolve(null)
    modal.remove()
  }

  const hasWb = useMemo(
    () => diff.wb.add.length + diff.wb.update.length + diff.wb.remove.length > 0,
    [diff]
  )
  const hasCc = useMemo(
    () => diff.cc.add.length + diff.cc.update.length + diff.cc.remove.length > 0,
    [diff]
  )

  return (
    <Modal
      opened
      onClose={cancel}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      title="更新预览 — 逐条勾选要应用的变更"
      size="lg"
      centered
    >
      {total === 0 ? (
        <Text c="dimmed" size="sm">模型未提出任何变更，无需更新。</Text>
      ) : (
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            已勾选 {selTotal}/{total} 条。勾中的条目才会写入；未勾选的保持原样（应用前自动备份快照）。
          </Text>
          <Box style={{ maxHeight: 420, overflow: 'auto', paddingRight: 4 }}>
            <Stack gap="sm">
              {hasWb && <Divider label="世界书" labelPosition="left" />}
              <PickEntryList title="新增" color="green" items={diff.wb.add} getLabel={wbName} selected={sel.wb.add} onToggle={(i) => toggle('wb', 'add', i)} />
              <PickEntryList title="更新" color="blue" items={diff.wb.update} getLabel={wbName} selected={sel.wb.update} onToggle={(i) => toggle('wb', 'update', i)} />
              <PickRemoveList title="删除" names={diff.wb.remove} selected={sel.wb.remove} onToggle={(n) => toggleRemove('wb', n)} />
              {hasCc && <Divider label="人物卡" labelPosition="left" />}
              <PickEntryList title="新增" color="green" items={diff.cc.add} getLabel={ccName} selected={sel.cc.add} onToggle={(i) => toggle('cc', 'add', i)} />
              <PickEntryList title="更新" color="blue" items={diff.cc.update} getLabel={ccName} selected={sel.cc.update} onToggle={(i) => toggle('cc', 'update', i)} />
              <PickRemoveList title="删除" names={diff.cc.remove} selected={sel.cc.remove} onToggle={(n) => toggleRemove('cc', n)} />
            </Stack>
          </Box>
          <Group justify="space-between" gap="sm">
            <Button variant="subtle" size="xs" onClick={toggleAll} disabled={busy}>
              {allSelected ? '全部取消' : '全部勾选'}
            </Button>
            <Group gap="sm">
              <Button variant="subtle" onClick={cancel} disabled={busy}>取消</Button>
              <Button color="chatbox-brand" onClick={apply} disabled={busy || selTotal === 0}>
                {busy ? '应用中…' : `应用选中（${selTotal}）`}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
})

export default ModUpdatePreview
