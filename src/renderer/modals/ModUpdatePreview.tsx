/**
 * Chatbox Mod —— 自动更新预览确认弹窗（逐条勾选 + 新旧对比）
 *
 * 模型算出的世界书/人物卡差异（新增/更新/删除）逐条列出：
 * - 新增：新条目内容预览（人物卡展示完整字段）
 * - 更新：「旧 → 新」对比，一眼看出这次会改/丢什么
 * - 删除：红色标注将被删条目的内容摘要
 * 用户勾选要应用的条目，确认后返回「勾选后的差异 diff」；取消返回 null。
 * 注册名 'mod-update-preview'。
 */
import { useMemo, useState } from 'react'
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { getDefaultStore } from 'jotai'
import { Alert, Badge, Box, Button, Checkbox, Divider, Flex, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import type { AutoUpdateDiff } from '../modules/auto-update'
import { isTrivialChange } from '../modules/text-similarity'
import { diffText, summarizeChanges, segmentForOld, segmentForNew } from '../modules/text-diff'
import { characterCardsAtom, worldBooksAtom } from '../modules/store'

type Sel = { add: Set<number>; update: Set<number>; remove: Set<string> }
type SelAll = { wb: Sel; cc: Sel }

function newSel(add: number, update: number, remove: string[]): Sel {
  return {
    add: new Set(Array.from({ length: add }, (_, i) => i)),
    update: new Set(Array.from({ length: update }, (_, i) => i)),
    remove: new Set(remove),
  }
}

/** 初始勾选：轻微改动（相似度 ≥ 阈值）的 update 默认不勾选，其余全部勾选 */
function newSelFiltered(add: number, update: number, remove: string[], trivialUpdate: Set<number>): Sel {
  const upd = new Set<number>()
  for (let i = 0; i < update; i++) if (!trivialUpdate.has(i)) upd.add(i)
  return {
    add: new Set(Array.from({ length: add }, (_, i) => i)),
    update: upd,
    remove: new Set(remove),
  }
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** 新增条目列表（世界书/人物卡通用）：每条 checkbox + 名称 + 内容摘要 */
function PickEntryList({
  title, color, items, getLabel, selected, onToggle, previewField,
}: {
  title: string
  color: string
  items: Array<Record<string, unknown>>
  getLabel: (x: Record<string, unknown>) => string
  selected: Set<number>
  onToggle: (idx: number) => void
  previewField: string
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
          const extra = String(it[previewField] ?? '')
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
                      {clip(extra, 60)}
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

/** 词级 diff 渲染：将 ops 转成带样式的文本段（旧：删除标红删除线；新：新增标绿下划线） */
function DiffText({ segments, tone }: { segments: ReturnType<typeof segmentForOld>; tone: 'old' | 'new' }) {
  return (
    <Text size="xs" c={tone === 'old' ? 'dimmed' : undefined} style={{ lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
      {segments.map((seg, i) =>
        seg.kind === 'del' ? (
          <Text span key={i} c="red" td="line-through" style={{ background: '#fde2e2', textDecorationThickness: 1.2 }}>{seg.text}</Text>
        ) : seg.kind === 'ins' ? (
          <Text span key={i} c="green" td="underline" style={{ background: '#dff5e4', textDecorationThickness: 1.2 }}>{seg.text}</Text>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </Text>
  )
}

/** 更新条目卡片：词级 diff 高亮 + 改点摘要 + 增减统计 + 可编辑「新内容」 */
function DiffUpdateCard({
  label, oldTxt, newTxt, checked, isTrivial, editing, editValue, onToggle, onEdit, onDone, onCancel, onEditChange,
}: {
  label: string
  oldTxt: string
  newTxt: string
  checked: boolean
  isTrivial: boolean
  editing: boolean
  editValue: string
  onToggle: () => void
  onEdit: () => void
  onDone: () => void
  onCancel: () => void
  onEditChange: (v: string) => void
}) {
  const ops = useMemo(() => diffText(oldTxt, newTxt), [oldTxt, newTxt])
  const summary = useMemo(() => summarizeChanges(ops), [ops])
  const oldSegs = useMemo(() => segmentForOld(ops), [ops])
  const newSegs = useMemo(() => segmentForNew(ops), [ops])
  const cardBorder = checked ? (isTrivial ? '1.5px solid #ed8936' : '1.5px solid #2563eb') : isTrivial ? '1px solid #ffe0b2' : '1px solid #e0e0e0'
  const cardBg = checked ? (isTrivial ? '#fff4e5' : '#eff6ff') : isTrivial ? '#fff8f0' : '#fafafa'
  return (
    <Box style={{ border: cardBorder, borderRadius: 6, padding: '6px 8px', background: cardBg }}>
      {/* 顶部：勾选框 / 名称 / 增减统计 / 编辑按钮 */}
      <Flex align="center" gap={4} mb={3} style={{ cursor: 'pointer' }} onClick={onToggle}>
        <Checkbox size="xs" checked={checked} onChange={onToggle} style={{ pointerEvents: 'none' }} />
        <Text size="xs" fw={600} style={{ flex: 1, minWidth: 0 }}>{label}</Text>
        {(summary.del > 0 || summary.ins > 0) && (
          <Badge size="xs" variant="light" color="red">{`-${summary.del}`}</Badge>
        )}
        {(summary.ins > 0) && (
          <Badge size="xs" variant="light" color="green">{`+${summary.ins}`}</Badge>
        )}
        {isTrivial ? <Badge size="xs" color="orange" variant="light">仅轻微改动</Badge> : null}
        <Button size="compact-xs" variant="subtle" color="chatbox-brand" onClick={(e) => { e.stopPropagation(); onEdit() }}>
          {editing ? '编辑中' : '编辑'}
        </Button>
      </Flex>
      {/* 旧（只读，滚动看全文；删除词标红删除线） */}
      <Box style={{ border: '1px solid #f0e0e0', borderRadius: 4, background: '#fff9f9', padding: '4px 6px', marginBottom: 4 }}>
        <Text size="xs" c="dimmed" fw={600} style={{ marginBottom: 2 }}>旧（只读）</Text>
        <Box style={{ maxHeight: 96, overflow: 'auto' }}>
          <DiffText segments={oldSegs} tone="old" />
        </Box>
      </Box>
      {/* 新（浏览态 diff 高亮 / 编辑态 textarea） */}
      <Box style={{ border: '1px solid #e0f0e0', borderRadius: 4, background: '#f7fff7', padding: '4px 6px' }}>
        <Text size="xs" c="dimmed" fw={600} style={{ marginBottom: 2 }}>新（可编辑）</Text>
        {editing ? (
          <>
            <Textarea
              size="xs"
              autosize
              minRows={3}
              maxRows={8}
              value={editValue}
              onChange={(e) => onEditChange(e.currentTarget.value)}
              data-testid="update-preview-edit-textarea"
            />
            <Flex gap="xs" mt={4} justify="flex-end">
              <Button size="compact-xs" variant="subtle" onClick={onCancel}>取消</Button>
              <Button size="compact-xs" color="chatbox-brand" onClick={onDone}>完成</Button>
            </Flex>
          </>
        ) : (
          <Box style={{ maxHeight: 96, overflow: 'auto' }}>
            <DiffText segments={newSegs} tone="new" />
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** 更新条目列表：词级 diff 高亮 + 编辑态 + 轻微改动标签 */
function PickUpdateList({
  title, items, getLabel, selected, onToggle, oldOf, oldField, newField, trivial,
  editingKey, editValues, onEnterEdit, onDoneEdit, onCancelEdit, onEditChange,
}: {
  title: string
  items: Array<Record<string, unknown>>
  getLabel: (x: Record<string, unknown>) => string
  selected: Set<number>
  onToggle: (idx: number) => void
  oldOf: (name: string) => Record<string, unknown> | undefined
  oldField: string
  newField: string
  trivial?: Set<number>
  editingKey: string | null
  editValues: Record<string, string>
  onEnterEdit: (key: string, value: string) => void
  onDoneEdit: (key: string) => void
  onCancelEdit: (key: string) => void
  onEditChange: (key: string, v: string) => void
}) {
  if (items.length === 0) return null
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge size="xs" color="blue">{title}</Badge>
        <Text size="xs" c="dimmed">{selected.size}/{items.length} 条{trivial && trivial.size > 0 ? `（轻微改动 ${trivial.size} 条默认未勾选）` : ''}</Text>
      </Group>
      <Stack gap={5}>
        {items.slice(0, 20).map((raw, i) => {
          const it = raw as Record<string, unknown>
          const label = getLabel(it)
          const oldIt = oldOf(label)
          const oldTxt = oldIt ? String(oldIt[oldField] ?? '') : ''
          const newTxt = String(it[newField] ?? '')
          const isTrivial = Boolean(trivial?.has(i))
          const checked = selected.has(i)
          const key = `${title}:${label}`
          const editing = editingKey === key
          const editValue = editingKey === key ? (editValues[key] ?? newTxt) : newTxt
          if (!oldIt) {
            return (
              <Box key={i} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: '6px 8px', background: '#fafafa', cursor: 'pointer' }} onClick={() => onToggle(i)}>
                <Group gap={4}>
                  <Checkbox size="xs" checked={checked} onChange={() => onToggle(i)} style={{ pointerEvents: 'none' }} />
                  <Text size="xs" fw={600}>{label}</Text>
                  <Text size="xs" c="dimmed">（未找到同名旧条目，此条实际不会执行更新）</Text>
                </Group>
              </Box>
            )
          }
          return (
            <DiffUpdateCard
              key={i}
              label={label}
              oldTxt={oldTxt}
              newTxt={newTxt}
              checked={checked}
              isTrivial={isTrivial}
              editing={editing}
              editValue={editValue}
              onToggle={() => onToggle(i)}
              onEdit={() => onEnterEdit(key, newTxt)}
              onDone={() => onDoneEdit(key)}
              onCancel={() => onCancelEdit(key)}
              onEditChange={(v) => onEditChange(key, v)}
            />
          )
        })}
        {items.length > 20 ? <Text size="xs" c="dimmed">… 其余 {items.length - 20} 条省略</Text> : null}
      </Stack>
    </Box>
  )
}

/** 删除条目列表：每条 checkbox + 将被删内容摘要（红色） */
function PickRemoveList({
  title, names, selected, onToggle, summaryOf,
}: {
  title: string
  names: string[]
  selected: Set<string>
  onToggle: (name: string) => void
  summaryOf: (name: string) => string
}) {
  if (names.length === 0) return null
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge size="xs" color="red">{title}</Badge>
        <Text size="xs" c="dimmed">{selected.size}/{names.length} 条</Text>
      </Group>
      <Stack gap={5}>
        {names.slice(0, 20).map((n, i) => {
          const sum = summaryOf(n)
          const checked = selected.has(n)
          return (
            <Box key={i} style={{ border: checked ? '1.5px solid #ef4444' : '1px solid #ffcdd2', borderRadius: 6, padding: '6px 8px', background: checked ? '#fef2f2' : '#fff5f5', cursor: 'pointer' }} onClick={() => onToggle(n)}>
              <Group gap={4}>
                <Checkbox size="xs" checked={checked} onChange={() => onToggle(n)} style={{ pointerEvents: 'none' }} />
                <Text size="xs" fw={600} c="red">{n}</Text>
              </Group>
              {sum ? <Text size="xs" c="dimmed" style={{ display: 'block', marginTop: 3 }}>{clip(sum, 80)}</Text> : null}
            </Box>
          )
        })}
        {names.length > 20 ? <Text size="xs" c="dimmed">… 其余 {names.length - 20} 条省略</Text> : null}
      </Stack>
    </Box>
  )
}

/** 新增人物卡：完整字段预览 */
function PickNewCardList({
  title, items, selected, onToggle,
}: {
  title: string
  items: Array<Record<string, unknown>>
  selected: Set<number>
  onToggle: (idx: number) => void
}) {
  if (items.length === 0) return null
  const fields: Array<[string, string]> = [
    ['age', '年龄'], ['gender', '性别'], ['occupation', '职业'], ['appearance', '外貌'],
    ['height', '身高'], ['weight', '体重'], ['distinguishingFeatures', '显著特征'],
    ['personalityType', '性格类型'], ['strengths', '优点'], ['weaknesses', '缺点'], ['hobbies', '爱好'],
    ['backgroundStory', '背景故事'],
  ]
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge size="xs" color="green">{title}</Badge>
        <Text size="xs" c="dimmed">{selected.size}/{items.length} 张</Text>
      </Group>
      <Stack gap={5}>
        {items.slice(0, 10).map((raw, i) => {
          const it = raw as Record<string, unknown>
          const name = String(it.name ?? '（未命名）')
          const rels = Array.isArray(it.relationships) && it.relationships.length
            ? it.relationships.map((r: Record<string, unknown>) => `${r.targetName ?? ''}（${r.relation ?? ''}）${r.description ? `：${r.description}` : ''}`).join('；')
            : ''
          const checked = selected.has(i)
          return (
            <Box key={i} style={{ border: checked ? '1.5px solid #16a34a' : '1px solid #c8e6c9', borderRadius: 6, padding: '6px 8px', background: checked ? '#f0fdf4' : '#f7fbf7', cursor: 'pointer' }} onClick={() => onToggle(i)}>
              <Group gap={4} mb={3}>
                <Checkbox size="xs" checked={checked} onChange={() => onToggle(i)} style={{ pointerEvents: 'none' }} />
                <Text size="xs" fw={600}>{name}</Text>
              </Group>
              <Stack gap={1}>
                {fields.map(([k, label]) => {
                  const v = String(it[k] ?? '').trim()
                  if (!v || v === '未知') return null
                  return (
                    <Text key={k} size="xs" style={{ display: 'block', lineHeight: 1.5 }}>
                      <Text span fw={600} c="dimmed">{label}</Text>：{clip(v, 80)}
                    </Text>
                  )
                })}
                {rels ? <Text size="xs" style={{ display: 'block', lineHeight: 1.5 }}><Text span fw={600} c="dimmed">关系</Text>：{clip(rels, 80)}</Text> : null}
              </Stack>
            </Box>
          )
        })}
        {items.length > 10 ? <Text size="xs" c="dimmed">… 其余 {items.length - 10} 张省略</Text> : null}
      </Stack>
    </Box>
  )
}

const ModUpdatePreview = NiceModal.create(({ diff }: { diff: AutoUpdateDiff }) => {
  const modal = useModal()
  const [busy, setBusy] = useState(false)
  // 从 store 读当前条目，用于「旧 → 新」对比、删除摘要与轻微改动判定
  const oldLookup = useMemo(() => {
    const store = getDefaultStore()
    const wbMap = new Map<string, Record<string, unknown>>()
    for (const w of store.get(worldBooksAtom)) wbMap.set(w.name, { content: w.content })
    const ccMap = new Map<string, Record<string, unknown>>()
    for (const c of store.get(characterCardsAtom)) ccMap.set(c.name, { backgroundStory: c.backgroundStory })
    return { wbOf: (n: string) => wbMap.get(n), ccOf: (n: string) => ccMap.get(n) }
  }, [])
  // 轻微改动集合：新旧内容高度相似且长度无明显增长的 update 条目（默认不勾选，可手动勾选应用）
  const trivialWb = useMemo(() => {
    const s = new Set<number>()
    diff.wb.update.forEach((it, i) => {
      const oldIt = oldLookup.wbOf(String(it.name ?? ''))
      const oldTxt = oldIt ? String(oldIt.content ?? '') : ''
      const newTxt = String(it.content ?? '')
      if (oldTxt && newTxt && isTrivialChange(oldTxt, newTxt)) s.add(i)
    })
    return s
  }, [diff, oldLookup])
  const trivialCc = useMemo(() => {
    const s = new Set<number>()
    diff.cc.update.forEach((it, i) => {
      const oldIt = oldLookup.ccOf(String(it.name ?? ''))
      const oldTxt = oldIt ? String(oldIt.backgroundStory ?? '') : ''
      const newTxt = String(it.backgroundStory ?? '')
      if (oldTxt && newTxt && isTrivialChange(oldTxt, newTxt)) s.add(i)
    })
    return s
  }, [diff, oldLookup])

  const [sel, setSel] = useState<SelAll>(() => ({
    wb: newSelFiltered(diff.wb.add.length, diff.wb.update.length, diff.wb.remove, trivialWb),
    cc: newSelFiltered(diff.cc.add.length, diff.cc.update.length, diff.cc.remove, trivialCc),
  }))
  // 关联事件追加：默认全选（只增不改，低风险），可取消（v2.2 全量追加，无判重拦截/无 _dedup 元数据）
  const events = diff.events?.append ?? []
  const [selEvents, setSelEvents] = useState<Set<number>>(() => new Set(events.map((_, i) => i)))
  // 横幅统计：新增 = 勾选条数（v2.2 无跳过/合并概念）
  const eventAddCount = selEvents.size
  // 编辑态：editingKey = `${group}:${name}`；editedMap 存「本次要应用的新内容」
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editedMap, setEditedMap] = useState<Record<string, string>>({})
  const wbName = (x: Record<string, unknown>) => String(x.name ?? '（未命名）')
  const ccName = (x: Record<string, unknown>) => String(x.name ?? '（未命名）')

  const enterEdit = (key: string, value: string) => {
    setEditingKey(key)
    setEditedMap((m) => (m[key] === undefined ? { ...m, [key]: value } : m))
  }
  const doneEdit = (key: string) => setEditingKey(null)
  const cancelEdit = (key: string) => {
    setEditingKey(null)
    setEditedMap((m) => {
      const next = { ...m }
      delete next[key]
      return next
    })
  }
  const changeEdit = (key: string, v: string) => setEditedMap((m) => ({ ...m, [key]: v }))

  const total = diff.wb.add.length + diff.wb.update.length + diff.wb.remove.length +
    diff.cc.add.length + diff.cc.update.length + diff.cc.remove.length + events.length
  const selTotal = sel.wb.add.size + sel.wb.update.size + sel.wb.remove.size +
    sel.cc.add.size + sel.cc.update.size + sel.cc.remove.size + selEvents.size
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
  const toggleEvent = (idx: number) => {
    setSelEvents((s) => {
      const next = new Set(s)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }
  const toggleAll = () => {
    if (allSelected) {
      setSel({ wb: { add: new Set(), update: new Set(), remove: new Set() }, cc: { add: new Set(), update: new Set(), remove: new Set() } })
      setSelEvents(new Set())
    } else {
      setSel({
        wb: newSel(diff.wb.add.length, diff.wb.update.length, diff.wb.remove),
        cc: newSel(diff.cc.add.length, diff.cc.update.length, diff.cc.remove),
      })
      // 全部勾选 = 全部事件「仍新增」
      setSelEvents(new Set(events.map((_, i) => i)))
    }
  }
  const apply = () => {
    if (busy || selTotal === 0) return
    setBusy(true)
    const pick = <T,>(arr: T[], s: Set<number>) => arr.filter((_, i) => s.has(i))
    // 勾选并编辑过的 update 条目，用编辑后文本覆盖对应字段（content / backgroundStory）
    const override = (group: 'wb' | 'cc', items: Array<Record<string, unknown>>, field: string) =>
      items.map((it, i) => {
        const key = `${group === 'wb' ? '更新' : '更新'}:${String(it.name ?? '')}`
        const edited = editedMap[key]
        if (edited === undefined || edited === String(it[field] ?? '')) return it
        return { ...it, [field]: edited }
      })
    // 勾选的事件 = 正常追加（去掉可能的残留 _dedup 元数据）；未勾选 = 不追加
    const pickedEvents = events
      .map((e, i) => ({ e, i }))
      .filter(({ i }) => selEvents.has(i))
      .map(({ e }) => {
        const { _dedup, ...rest } = e
        return rest
      })
    const result: AutoUpdateDiff = {
      wb: {
        add: pick(diff.wb.add, sel.wb.add),
        update: override('wb', pick(diff.wb.update, sel.wb.update), 'content'),
        remove: diff.wb.remove.filter((n) => sel.wb.remove.has(n)),
      },
      cc: {
        add: pick(diff.cc.add, sel.cc.add),
        update: override('cc', pick(diff.cc.update, sel.cc.update), 'backgroundStory'),
        remove: diff.cc.remove.filter((n) => sel.cc.remove.has(n)),
      },
      events: { append: pickedEvents },
    }
    modal.resolve(result)
    modal.remove()
  }
  const cancel = () => {
    if (busy) return
    modal.resolve(null)
    modal.remove()
  }

  const hasWb = diff.wb.add.length + diff.wb.update.length + diff.wb.remove.length > 0
  const hasCc = diff.cc.add.length + diff.cc.update.length + diff.cc.remove.length > 0

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
          {diff.rangeNote ? (
            <Alert variant="light" color="yellow" title="分析范围提示" px="sm" py="xs">
              <Text size="xs">{diff.rangeNote}</Text>
            </Alert>
          ) : null}
          <Text size="xs" c="dimmed">
            已勾选 {selTotal}/{total} 条。更新条目会显示「旧 → 新」对比，确认旧信息没有被丢弃再勾选；删除条目为红色标注（应用前自动备份快照）。<Text span fw={600} c="orange">「仅轻微改动」条目与旧版基本一致，默认未勾选，需要应用请手动勾选。</Text>
          </Text>
          <Box style={{ maxHeight: 430, overflow: 'auto', paddingRight: 4 }}>
            <Stack gap="sm">
              {hasWb && <Divider label="世界书" labelPosition="left" />}
              <PickEntryList title="新增" color="green" items={diff.wb.add} getLabel={wbName} selected={sel.wb.add} onToggle={(i) => toggle('wb', 'add', i)} previewField="content" />
              <PickUpdateList
                title="更新" items={diff.wb.update} getLabel={wbName} selected={sel.wb.update}
                onToggle={(i) => toggle('wb', 'update', i)} oldOf={oldLookup.wbOf} oldField="content" newField="content"
                trivial={trivialWb}
                editingKey={editingKey} editValues={editedMap}
                onEnterEdit={enterEdit} onDoneEdit={doneEdit} onCancelEdit={cancelEdit} onEditChange={changeEdit}
              />
              <PickRemoveList title="删除" names={diff.wb.remove} selected={sel.wb.remove} onToggle={(n) => toggleRemove('wb', n)} summaryOf={(n) => String(oldLookup.wbOf(n)?.content ?? '')} />
              {hasCc && <Divider label="人物卡" labelPosition="left" />}
              <PickNewCardList title="新建人物卡" items={diff.cc.add} selected={sel.cc.add} onToggle={(i) => toggle('cc', 'add', i)} />
              <PickUpdateList
                title="更新" items={diff.cc.update} getLabel={ccName} selected={sel.cc.update}
                onToggle={(i) => toggle('cc', 'update', i)} oldOf={oldLookup.ccOf} oldField="backgroundStory" newField="backgroundStory"
                trivial={trivialCc}
                editingKey={editingKey} editValues={editedMap}
                onEnterEdit={enterEdit} onDoneEdit={doneEdit} onCancelEdit={cancelEdit} onEditChange={changeEdit}
              />
              <PickRemoveList title="删除" names={diff.cc.remove} selected={sel.cc.remove} onToggle={(n) => toggleRemove('cc', n)} summaryOf={(n) => String(oldLookup.ccOf(n)?.backgroundStory ?? '')} />
              {events.length > 0 && (
                <>
                  <Divider label="关联事件（追加到角色事件区，只增不改）" labelPosition="left" />
                  <Flex align="center" gap={6} style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px' }}>
                    <Text size="xs" fw={600} c="orange">新增 {eventAddCount} 条</Text>
                  </Flex>
                  {events.map((e, i) => (
                    <Box key={i} style={{ border: selEvents.has(i) ? '1.5px solid #2563eb' : '1px solid #e0e0e0', borderRadius: 6, padding: '4px 8px', background: selEvents.has(i) ? '#eff6ff' : '#fafafa', cursor: 'pointer' }} onClick={() => toggleEvent(i)}>
                      <Flex align="center" gap={4}>
                        <Checkbox size="xs" checked={selEvents.has(i)} onChange={() => toggleEvent(i)} style={{ pointerEvents: 'none' }} />
                        <Text size="xs" fw={600} style={{ flex: 1, minWidth: 0 }}>{String(e.roleName ?? e.name ?? '（未命名）')}</Text>
                      </Flex>
                      <Text size="xs" style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{String(e.content ?? '')}</Text>
                      {Array.isArray(e.keywords) && e.keywords.length > 0 ? <Text size="xs" c="blue">触发词: {e.keywords.join(' / ')}</Text> : null}
                    </Box>
                  ))}
                </>
              )}
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
