/**
 * Chatbox Mod —— 创作资料管理页
 *
 * 官方 React 组件实现（Mantine），替代 v48 的 DOM 文本匹配轮询方案。
 * 覆盖：世界书 / 人物卡 / 会话装载 / 自动更新 / 小说分章 / 设置·导出·日志。
 */
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Flex,
  Group,
  Grid,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconArrowBack, IconBook2, IconBookDownload, IconBookUpload, IconCircleCheck, IconCircleX, IconDots, IconDownload, IconFolderOpen, IconGitMerge, IconHistory, IconMenu2, IconPencil, IconRefresh, IconRobot, IconSearch, IconSettings, IconSnowflake, IconTrash, IconUsers, IconWand } from '@tabler/icons-react'
import NiceModal from '@ebay/nice-modal-react'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import Page from '@/components/layout/Page'
import { currentSessionIdAtom } from '@/stores/atoms/sessionAtoms'
import { useSessionSettings } from '@/stores/session/session-settings'
import {
  addOrUpdateCharacterCard,
  addOrUpdateWorldBook,
  characterCardsAtom,
  clearModLog,
  createEmptyCharacterCard,
  foldersAtom,
  modBackupsAtom,
  modLogAtom,
  modSettingsAtom,
  moveItemsToFolder,
  removeCharacterCard,
  removeItems,
  removeWorldBook,
  restoreCharacterCardVersion,
  restoreModBackup,
  restoreWorldBookVersion,
  setItemsEnabled,
  toggleCharacterCard,
  toggleWorldBook,
  updateModSettings,
  upsertFolder,
  worldBooksAtom,
} from '../store'
import type { CharacterCard, ModFolder, WorldBookEntry } from '../types'
import { addBindingItems, clearBinding, getBinding, listSessionsMeta, replaceBinding, setBinding } from '../session'
import type { SessionMetaLike } from '../session'
import { forceUnlockAutoUpdate, isAutoUpdateRunning, maybeAutoUpdateWorldBooks } from '../auto-update'
import { buildExportPayload, importModData } from '../export'
import { ExportModal, type ExportModalConfig } from './ExportModal'
import {
  detectCardJsonFormat,
  diagnosePngCard,
  isPngBytes,
  parseCharacterCardJson,
  parseCharacterCardPng,
  mapTavernCardToMod,
  type TavernCardData,
} from '../png-character-import'
import { toggleFrozen } from '../frozen-text'
import { splitChapters, v27Continue, v283EnsureSession, v283GenOptions, v283PushChapter, v283Rewrite } from '../novel'
import type { RewritePlan } from '../novel'
import { importNovelBook, novelBooksAtom, parseNovelImport, removeNovelBook, upsertRewriteNode } from '../novel-rewrite'
import type { NovelBook, NovelChapter, RewriteNode } from '../types'
import { MOD_BUILD } from '../version'

export function ChatboxModPage() {
  return (
    <Page title="Chatbox Mod">
      <Tabs defaultValue="worldbook" keepMounted={false} style={{ flex: 1, minHeight: 0 }}>
        <Tabs.List>
          <Tabs.Tab value="worldbook" leftSection={<IconBook2 size={16} />}>世界书</Tabs.Tab>
          <Tabs.Tab value="characters" leftSection={<IconUsers size={16} />}>人物卡</Tabs.Tab>
          <Tabs.Tab value="binding" leftSection={<IconRobot size={16} />}>会话装载</Tabs.Tab>
          <Tabs.Tab value="auto" leftSection={<IconRefresh size={16} />}>自动更新</Tabs.Tab>
          <Tabs.Tab value="novel" leftSection={<IconWand size={16} />}>小说续写</Tabs.Tab>
          <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>设置/导出</Tabs.Tab>
        </Tabs.List>
        <Box p="md" style={{ overflow: 'auto', height: '100%' }}>
          <Tabs.Panel value="worldbook"><WorldBooksTab /></Tabs.Panel>
          <Tabs.Panel value="characters"><CharactersTab /></Tabs.Panel>
          <Tabs.Panel value="binding"><BindingTab /></Tabs.Panel>
          <Tabs.Panel value="auto"><AutoUpdateTab /></Tabs.Panel>
          <Tabs.Panel value="novel"><NovelTab /></Tabs.Panel>
          <Tabs.Panel value="settings"><SettingsTab /></Tabs.Panel>
        </Box>
      </Tabs>
    </Page>
  )
}

/* ======================== 多选与导入导出（世界书/人物卡共用） ======================== */

/** PNG 人物卡：立绘缩放为 256px 方形头像（dataURL），控制存储体积 */
async function pngToAvatarDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(new Error('读取图片失败'))
    fr.readAsDataURL(file)
  })
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('图片解码失败'))
      im.src = dataUrl
    })
    const canvas = document.createElement('canvas')
    const size = 256
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    const scale = Math.max(size / img.width, size / img.height)
    const w = img.width * scale
    const h = img.height * scale
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return dataUrl
  }
}

/** 冻结文本输入：Textarea + 「冻结选中」按钮 + 冻结段列表（点段取消冻结，toggle，按字段归属） */
function FrozenTextarea({
  label, field, value, onChange, frozenTexts, onFrozenChange, minRows = 6,
}: {
  label: string
  field: string
  value: string
  onChange: (v: string) => void
  frozenTexts: Array<{ field: string; text: string } | string> | undefined
  onFrozenChange: (list: Array<{ field: string; text: string }>) => void
  minRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const mine = (Array.isArray(frozenTexts) ? frozenTexts : [])
    .map((x) => (typeof x === 'string' ? { field, text: x } : x))
    .filter((x) => x.field === field)
  const freezeSelection = () => {
    const el = ref.current
    if (!el) return
    const s = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
    if (!s.trim()) return
    onFrozenChange(toggleFrozen(frozenTexts ?? [], field, s))
  }
  return (
    <Box>
      <Group justify="space-between" align="center" mb={4}>
        <Text size="sm" fw={600}>{label}</Text>
        <Button size="compact-xs" variant="light" color="red" leftSection={<IconSnowflake size={12} />} onClick={freezeSelection}>
          冻结选中
        </Button>
      </Group>
      <Textarea
        ref={ref}
        autosize
        minRows={minRows}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      {mine.length > 0 ? (
        <Stack gap={4} mt={4}>
          <Text size="xs" c="dimmed">冻结段（{mine.length}）— 自动更新不改写，点段可取消冻结</Text>
          {mine.map((f, i) => (
            <Box
              key={i}
              style={{ border: '1px solid #f2c1c1', background: '#fff4f4', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', lineHeight: 1.5 }}
              onClick={() => onFrozenChange(toggleFrozen(frozenTexts ?? [], field, f.text))}
            >
              <Text size="xs" c="red" style={{ wordBreak: 'break-word' }}>
                🔒 {f.text.replace(/\s+/g, ' ').slice(0, 42)}{f.text.length > 42 ? '…' : ''}
              </Text>
            </Box>
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}

/** 冻结选择模式：整张卡片的字段列表，点一下整段冻结/取消（再点一次取消） */
function FreezePicker({
  fields, frozenTexts, onFrozenChange, onExit,
}: {
  fields: Array<{ field: string; label: string; content: string }>
  frozenTexts: Array<{ field: string; text: string } | string> | undefined
  onFrozenChange: (list: Array<{ field: string; text: string }>) => void
  onExit: () => void
}) {
  const raw = Array.isArray(frozenTexts) ? frozenTexts : []
  const isFrozen = (field: string, content: string) => {
    const t = content.trim()
    if (!t) return false
    return raw.some((x) => (typeof x === 'string' ? x.trim() === t : x.field === field && x.text === t))
  }
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>冻结选择 — 点击字段整段冻结，再点一次取消</Text>
      <Text size="xs" c="dimmed">冻结的段落自动更新不会改写（AI 动过就原文回填）</Text>
      {fields.map((f) => {
        const frozen = isFrozen(f.field, f.content)
        return (
          <Box
            key={f.field}
            style={{
              border: frozen ? '1.5px solid #f2a8a8' : '1px solid #e0e0e0',
              background: frozen ? '#fff1f1' : '#fafafa',
              borderRadius: 6, padding: '6px 10px', cursor: 'pointer', lineHeight: 1.5,
            }}
            onClick={() => onFrozenChange(toggleFrozen(frozenTexts ?? [], f.field, f.content))}
          >
            <Group justify="space-between" gap={6}>
              <Text size="sm" fw={600}>{f.label}</Text>
              {frozen ? <Badge size="sm" color="red" variant="light">🔒 已冻结</Badge> : <Badge size="sm" color="gray" variant="light">可冻结</Badge>}
            </Group>
            <Text size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>
              {f.content.trim() ? `${f.content.replace(/\s+/g, ' ').slice(0, 80)}${f.content.length > 80 ? '…' : ''}` : '（空，不能冻结）'}
            </Text>
          </Box>
        )
      })}
      <Group justify="flex-end" mt={4}>
        <Button size="xs" variant="subtle" onClick={onExit}>返回编辑</Button>
      </Group>
    </Stack>
  )
}

/** 多选状态管理 */
function useBatchSelect<T extends { id: string }>(items: T[]) {
  const [mode, setMode] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const clear = () => setSel(new Set())
  /** 全选/反选（传入当前过滤后的 id 列表） */
  const setMany = (ids: string[]) => setSel(new Set(ids))
  /** 列表变化时清理失效选中 */
  useEffect(() => {
    const valid = new Set(items.map((x) => x.id))
    setSel((s) => {
      const keep = new Set([...s].filter((id) => valid.has(id)))
      return keep.size === s.size ? s : keep
    })
  }, [items])
  return { mode, setMode, sel, setSel, toggle, clear, setMany }
}

/** 新建文件夹弹窗（共享） */
function NewFolderModal({ opened, onClose, kind, onCreated }: { opened: boolean; onClose: () => void; kind: 'wb' | 'cc'; onCreated: (f: ModFolder) => void }) {
  const [name, setName] = useState('')
  return (
    <Modal opened={opened} onClose={() => { setName(''); onClose() }} title="新建文件夹" size="sm">
      <Stack gap="sm">
        <TextInput
          placeholder="文件夹名称"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="subtle" size="xs" onClick={onClose}>取消</Button>
          <Button
            size="xs"
            disabled={!name.trim()}
            onClick={async () => {
              if (!name.trim()) return
              const folder: ModFolder = { id: uuidv4(), name: name.trim(), kind }
              await upsertFolder(folder)
              setName('')
              onClose()
              onCreated(folder)
            }}
          >
            创建
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** 分类标签行：全部(N) / 未分类(N) / 各文件夹(N) + 新建/管理文件夹 */
function CategoryTabs({
  kind,
  folders,
  items,
  active,
  onChange,
  onNewFolder,
}: {
  kind: 'wb' | 'cc'
  folders: ModFolder[]
  items: { folderId?: string }[]
  active: string
  onChange: (v: string) => void
  onNewFolder: () => void
}) {
  const counts = useMemo(() => {
    const none = items.filter((i) => !i.folderId).length
    const byFolder = new Map<string, number>()
    for (const i of items) {
      if (i.folderId) byFolder.set(i.folderId, (byFolder.get(i.folderId) ?? 0) + 1)
    }
    return { none, byFolder }
  }, [items])
  const tabs = [
    { key: 'all', label: `全部(${items.length})` },
    { key: 'none', label: `未分类(${counts.none})` },
    ...folders.map((f) => ({ key: f.id, label: `${f.name}(${counts.byFolder.get(f.id) ?? 0})` })),
  ]
  return (
    <Group gap={6} wrap="wrap">
      {tabs.map((t) => (
        <Button key={t.key} size="compact-xs" variant={active === t.key ? 'filled' : 'default'} onClick={() => onChange(t.key)}>
          {t.label}
        </Button>
      ))}
      <Button size="compact-xs" variant="subtle" onClick={onNewFolder}>+ 新建文件夹</Button>
      <FolderManager kind={kind} />
    </Group>
  )
}

/** 移动到文件夹下拉（含「＋新建文件夹」内联入口） */
function MoveFolderSelect({ kind, folders, ids, onMoved }: { kind: 'wb' | 'cc'; folders: ModFolder[]; ids: string[]; onMoved: () => void }) {
  const [newOpen, { open: openNew, close: closeNew }] = useDisclosure(false)
  return (
    <>
      <Select
        placeholder="移动到文件夹"
        clearable
        size="xs"
        leftSection={<IconFolderOpen size={14} />}
        data={[
          ...folders.map((f) => ({ value: f.id, label: f.name })),
          { value: '__new__', label: '＋ 新建文件夹…' },
        ]}
        onChange={(v) => {
          if (v === '__new__') {
            openNew()
            return
          }
          if (ids.length) void moveItemsToFolder(kind, ids, v ?? undefined)
          onMoved()
        }}
        style={{ minWidth: 150, width: '100%' }}
      />
      <NewFolderModal
        opened={newOpen}
        onClose={closeNew}
        kind={kind}
        onCreated={(f) => {
          if (ids.length) void moveItemsToFolder(kind, ids, f.id)
          onMoved()
        }}
      />
    </>
  )
}

/** 解析导入 JSON 文本为条目数组（兼容 3 种格式：条目数组 / 单条对象 / {worldBooks|characterCards:[...]} 导出包） */
function parseJsonArrayText(text: string): unknown[] {
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.characterCards)) return obj.characterCards
    if (Array.isArray(obj.worldBooks)) return obj.worldBooks
    // 单条对象（如单张人物卡 { name: "罗素", ... }）
    if (typeof obj.name === 'string') return [obj]
  }
  return []
}

/** 读取导入文件并解析为条目数组（复用 parseJsonArrayText，兼容 3 种格式） */
function readJsonArrayFile(file: File): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        resolve(parseJsonArrayText(String(r.result)))
      } catch (e) {
        reject(e)
      }
    }
    r.onerror = () => reject(new Error('文件读取失败'))
    r.readAsText(file, 'utf8')
  })
}

/* ======================== 世界书 ======================== */

export function WorldBooksTab() {
  const items = useAtomValue(worldBooksAtom)
  const folders = useAtomValue(foldersAtom)
  const [editing, setEditing] = useState<WorldBookEntry | null>(null)
  const [wbFreeze, setWbFreeze] = useState(false)
  const [opened, { open, close }] = useDisclosure(false)
  const [msg, setMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const bs = useBatchSelect(items)
  const wbFolders = folders.filter((f) => f.kind === 'wb')
  const [exportCfg, setExportCfg] = useState<ExportModalConfig | null>(null)
  const [exportOpen, { open: openExport, close: closeExport }] = useDisclosure(false)

  const openNew = () => {
    setWbFreeze(false)
    setEditing({ id: uuidv4(), name: '', content: '', keywords: [], enabled: true, triggerMode: 'keyword' })
    open()
  }
  const openEdit = (w: WorldBookEntry) => {
    setWbFreeze(false)
    setEditing({ ...w, keywords: [...w.keywords] })
    open()
  }
  const save = async () => {
    if (!editing) return
    if (editing.triggerMode === 'regex') {
      const p = Array.isArray(editing.keywords) ? editing.keywords[0] ?? '' : ''
      try {
        // eslint-disable-next-line no-new
        new RegExp(p)
      } catch {
        setMsg(`正则表达式无效，无法保存：${p}`)
        return
      }
    }
    await addOrUpdateWorldBook(editing)
    close()
  }

  const doExport = () => {
    setExportCfg({ defaultName: 'chatbox-mod-worldbooks.json', makeBlob: () => new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }) })
    openExport()
  }

  // 内部格式数组 → 逐条落库（数组 / 单条 / 导出包）
  const importWorldBooksFromArray = async (arr: unknown[]) => {
    let n = 0
    for (const raw of arr) {
      const it = raw as Partial<WorldBookEntry>
      if (!it || typeof it.name !== 'string' || !it.name.trim()) continue
      await addOrUpdateWorldBook({
        id: typeof it.id === 'string' && it.id ? it.id : uuidv4(),
        name: it.name.trim(),
        content: typeof it.content === 'string' ? it.content : '',
        keywords: Array.isArray(it.keywords) ? it.keywords.map(String) : [],
        enabled: it.enabled !== false,
        triggerMode: it.triggerMode === 'always' || it.triggerMode === 'regex' ? it.triggerMode : 'keyword',
        depth: typeof it.depth === 'number' ? it.depth : undefined,
        folderId: typeof it.folderId === 'string' ? it.folderId : undefined,
        order: Number(it.order) || 0,
        createdAt: typeof it.createdAt === 'number' ? it.createdAt : Date.now(),
        updatedAt: Date.now(),
      })
      n++
    }
    return n
  }

  const doImport = async (file: File | null) => {
    if (!file) return
    setImporting(true)
    try {
      // 先尝试识别酒馆 World Info 标准格式（JSON / CSV）
      const text = await file.text()
      const { parseWorldInfo } = await import('../world-info-import')
      const wi = parseWorldInfo(text)
      const arr = wi ? (wi as unknown as unknown[]) : parseJsonArrayText(text)
      const n = await importWorldBooksFromArray(arr)
      setMsg(arr.length === 0 ? '导入 0 条：文件中没有可识别的世界书（支持数组 / 单条 / 导出包 / 酒馆 World Info JSON·CSV 格式）' : `导入完成：${n} 条世界书`)
    } catch (e) {
      setMsg(`导入失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setImporting(false)
    }
  }

  // 粘贴 JSON 导入（绕开文件传输重编码）
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const doPasteImport = async () => {
    if (!pasteText.trim()) return
    setImporting(true)
    try {
      const { parseWorldInfo } = await import('../world-info-import')
      const wi = parseWorldInfo(pasteText)
      const arr = wi ? (wi as unknown as unknown[]) : parseJsonArrayText(pasteText)
      const n = await importWorldBooksFromArray(arr)
      setMsg(arr.length === 0 ? '导入 0 条：粘贴内容中没有可识别的世界书（支持数组 / 单条 / 导出包 / 酒馆 World Info JSON·CSV 格式）' : `导入完成：${n} 条世界书`)
      if (n > 0) setPasteText('')
    } catch (e) {
      setMsg(`导入失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setImporting(false)
    }
  }

  const selectedIds = [...bs.sel]

  // 搜索 + 分类过滤
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('all')
  const [newFolderOpen, { open: openNewFolder, close: closeNewFolder }] = useDisclosure(false)
  const filtered = useMemo(() => {
    let list = items
    if (cat === 'none') list = list.filter((i) => !i.folderId)
    else if (cat !== 'all') list = list.filter((i) => i.folderId === cat)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((i) => [i.name, i.content, ...(i.keywords ?? [])].join(' ').toLowerCase().includes(q))
    }
    return list
  }, [items, query, cat])

  // 导出选中
  const doExportSel = () => {
    const list = items.filter((i) => selectedIds.includes(i.id))
    setExportCfg({ defaultName: 'chatbox-mod-worldbooks-selected.json', makeBlob: () => new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }) })
    openExport()
    bs.clear()
  }
  // 全选/取消（按当前过滤结果）
  const toggleAll = () => {
    const ids = filtered.map((i) => i.id)
    if (bs.sel.size === ids.length && ids.length > 0) bs.clear()
    else bs.setMany(ids)
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Text c="dimmed" size="sm">{bs.mode ? `已选 ${bs.sel.size}/${filtered.length} 条` : (msg ? msg : `共 ${items.length} 条世界书`)}</Text>
        <Group gap={4}>
          <Tooltip label="选择世界书 JSON 文件（导入合并）">
            <label>
              <Button component="span" size="xs" variant="default" loading={importing}>导入</Button>
              <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => void doImport(e.target.files?.[0] ?? null)} />
            </label>
          </Tooltip>
          <Button size="xs" variant="default" onClick={() => setPasteOpen((v) => !v)}>粘贴导入</Button>
          <Button size="xs" variant="default" onClick={() => void doExport()}>导出</Button>
          {bs.mode ? (
            <Button size="xs" variant="filled" color="green" onClick={() => { bs.setMode(false); bs.clear() }}>完成</Button>
          ) : (
            <Button size="xs" variant="default" onClick={() => { bs.setMode(true); bs.clear() }}>多选</Button>
          )}
          {!bs.mode && (
            <Button size="xs" variant="default" onClick={() => { bs.setMode(true); bs.setMany(filtered.map((w) => w.id)) }}>全选</Button>
          )}
          {!bs.mode && <Button size="xs" onClick={openNew}>+ 新建世界书</Button>}
        </Group>
      </Group>
      {pasteOpen && (
        <Stack gap={6}>
          <Textarea
            size="xs"
            autosize
            minRows={3}
            maxRows={8}
            placeholder="粘贴世界书 JSON 文本（内部数组 / 单条 / 导出包 / 酒馆 World Info JSON），绕开文件传输问题"
            value={pasteText}
            onChange={(e) => setPasteText(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button size="compact-xs" variant="default" onClick={() => setPasteOpen(false)}>取消</Button>
            <Button size="compact-xs" color="green" loading={importing} onClick={() => void doPasteImport()}>粘贴导入</Button>
          </Group>
        </Stack>
      )}
      <TextInput
        placeholder="按名称、关键词搜索……"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        leftSection={<IconSearch size={14} />}
      />
      <CategoryTabs
        kind="wb"
        folders={wbFolders}
        items={items}
        active={cat}
        onChange={setCat}
        onNewFolder={() => { setCat('all'); openNewFolder() }}
      />
      <NewFolderModal opened={newFolderOpen} onClose={closeNewFolder} kind="wb" onCreated={(f) => setCat(f.id)} />
      {bs.mode && (
        <>
          <Grid columns={3} gutter="xs">
            <Grid.Col span={1}>
              <Button size="xs" variant={bs.sel.size === filtered.length && filtered.length > 0 ? 'filled' : 'default'} onClick={toggleAll} style={{ width: '100%' }}>全选</Button>
            </Grid.Col>
            <Grid.Col span={1}><Button size="xs" variant="default" leftSection={<IconCircleCheck size={14} />} style={{ width: '100%' }} onClick={() => { void setItemsEnabled('wb', selectedIds, true); bs.clear() }}>启用所选</Button></Grid.Col>
            <Grid.Col span={1}><Button size="xs" variant="default" leftSection={<IconCircleX size={14} />} style={{ width: '100%' }} onClick={() => { void setItemsEnabled('wb', selectedIds, false); bs.clear() }}>禁用所选</Button></Grid.Col>
            <Grid.Col span={2}><MoveFolderSelect kind="wb" folders={wbFolders} ids={selectedIds} onMoved={() => bs.clear()} /></Grid.Col>
            <Grid.Col span={1}><Button size="xs" variant="default" leftSection={<IconDownload size={14} />} style={{ width: '100%' }} onClick={() => void doExportSel()}>导出所选</Button></Grid.Col>
          </Grid>
          <Button size="xs" color="red" variant="filled" leftSection={<IconTrash size={14} />} style={{ width: '100%', marginTop: 6 }} onClick={async () => {
            const ok = await NiceModal.show('confirm', { title: '删除世界书', message: `确定删除选中的 ${selectedIds.length} 条世界书？删除不可撤销（可用设置/导出中的自动更新备份恢复）。`, confirmText: '删除', danger: true })
            if (ok) { void removeItems('wb', selectedIds); bs.clear() }
          }}>删除所选</Button>
        </>
      )}
      <Stack gap="xs">
        {filtered.map((w) => (
          <Card
            key={w.id}
            withBorder
            padding="sm"
            style={bs.mode ? { borderColor: bs.sel.has(w.id) ? 'var(--chatbox-brand-color, #2563eb)' : undefined, cursor: 'pointer' } : undefined}
            onClick={bs.mode ? () => bs.toggle(w.id) : undefined}
          >
            <Group justify="space-between" wrap="nowrap">
              {bs.mode && <Checkbox checked={bs.sel.has(w.id)} onChange={() => bs.toggle(w.id)} aria-label={w.name} size="sm" />}
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs">
                  <Text fw={600} size="sm" lineClamp={1}>{w.name}</Text>
                  <Badge size="xs" variant="light" color={w.triggerMode === 'always' ? 'green' : w.triggerMode === 'regex' ? 'grape' : 'blue'}>
                    {w.triggerMode === 'always' ? '始终' : w.triggerMode === 'regex' ? '正则' : '关键词'}
                  </Badge>
                  {w.folderId ? <Badge size="xs" variant="outline">{wbFolders.find((f) => f.id === w.folderId)?.name ?? '未知文件夹'}</Badge> : null}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{w.content}</Text>
                {w.keywords.length > 0 ? <Text size="xs" c="gray">{w.keywords.join('、')}</Text> : null}
              </Stack>
              {!bs.mode && (
                <Group gap={4} wrap="nowrap">
                  <Switch checked={w.enabled !== false} size="xs" onClick={(e) => e.stopPropagation()} onChange={(e) => void toggleWorldBook(w.id, e.currentTarget.checked)} />
                  <Button size="compact-xs" variant="subtle" onClick={(e) => { e.stopPropagation(); openEdit(w) }}>编辑</Button>
                  <Button size="compact-xs" variant="subtle" color="red" onClick={async (e) => {
                    e.stopPropagation()
                    const ok = await NiceModal.show('confirm', { title: '删除世界书', message: `确定删除「${w.name}」？删除不可撤销（可用设置/导出中的自动更新备份恢复）。`, confirmText: '删除', danger: true })
                    if (ok) void removeWorldBook(w.id)
                  }}>删除</Button>
                </Group>
              )}
            </Group>
          </Card>
        ))}
        {filtered.length === 0 ? <Text c="dimmed" size="sm">{items.length === 0 ? '还没有世界书，点击右上角新建。' : '当前筛选条件下没有匹配的世界书。'}</Text> : null}
      </Stack>

      <Modal opened={opened} onClose={close} title="编辑世界书" size="lg">
        {editing && (
          <Stack gap="sm">
            <Switch
              label="冻结模式（整段选择冻结）"
              checked={wbFreeze}
              onChange={(e) => setWbFreeze(e.currentTarget.checked)}
              size="xs"
            />
            {wbFreeze ? (
              <FreezePicker
                fields={[{ field: 'content', label: '内容', content: editing.content }]}
                frozenTexts={editing.frozenTexts}
                onFrozenChange={(list) => setEditing({ ...editing, frozenTexts: list })}
                onExit={() => setWbFreeze(false)}
              />
            ) : (
              <>
            <TextInput label="名称" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })} />
            <FrozenTextarea
              label="内容"
              field="content"
              value={editing.content}
              onChange={(c) => setEditing({ ...editing, content: c })}
              frozenTexts={editing.frozenTexts}
              onFrozenChange={(list) => setEditing({ ...editing, frozenTexts: list })}
            />
            {editing.triggerMode === 'regex' ? (
              <TextInput
                label="正则表达式（命中对话文本才注入，如：长安|長安|Chang'an）"
                value={editing.keywords[0] ?? ''}
                placeholder="长安|長安|Chang'an"
                onChange={(e) => setEditing({ ...editing, keywords: [e.currentTarget.value] })}
              />
            ) : (
              <TextInput
                label="触发关键词（逗号分隔）"
                value={editing.keywords.join('、')}
                onChange={(e) => setEditing({ ...editing, keywords: e.currentTarget.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) })}
              />
            )}
            <Group>
              <Select
                label="触发模式"
                data={[
                  { value: 'keyword', label: '关键词命中才注入' },
                  { value: 'regex', label: '正则命中才注入' },
                  { value: 'always', label: '始终注入' },
                ]}
                value={editing.triggerMode ?? 'keyword'}
                onChange={(v) => setEditing({ ...editing, triggerMode: (v as 'keyword' | 'regex' | 'always') ?? 'keyword' })}
              />
              <Select
                label="文件夹"
                placeholder="无"
                data={wbFolders.map((f) => ({ value: f.id, label: f.name }))}
                value={editing.folderId ?? null}
                onChange={(v) => setEditing({ ...editing, folderId: v ?? undefined })}
                clearable
              />
              <NumberInput label="排序（升序）" value={editing.order ?? 0} onChange={(v) => setEditing({ ...editing, order: Number(v) || 0 })} />
              <NumberInput label="注入深度（0=常驻最前）" value={editing.depth ?? 0} onChange={(v) => setEditing({ ...editing, depth: Math.max(0, Number(v) || 0) })} />
            </Group>
            <Group justify="flex-end">
              <Button variant="subtle" onClick={close}>取消</Button>
              <Button onClick={() => void save()}>保存</Button>
            </Group>
            {editing.history && editing.history.length > 0 ? (
              <Box style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: 8, background: '#fafafa' }}>
                <Text size="xs" fw={600} c="dimmed" mb={4}>历史版本（{editing.history.length}）— 恢复会覆盖当前内容，当前内容自动入历史</Text>
                <Stack gap={4}>
                  {[...editing.history].reverse().map((h, ri) => {
                    const realIdx = editing.history!.length - 1 - ri
                    return (
                      <Group key={realIdx} gap={6} justify="space-between" wrap="nowrap">
                        <Text size="xs" c="dimmed" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {new Date(h.t).toLocaleString()} · {h.content.replace(/\s+/g, ' ').slice(0, 36)}{h.content.length > 36 ? '…' : ''}
                        </Text>
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={async () => {
                            await restoreWorldBookVersion(editing.id, realIdx)
                            setEditing((e) => (e ? { ...e, content: h.content } : e))
                            setMsg('已恢复该历史版本')
                          }}
                        >
                          恢复
                        </Button>
                      </Group>
                    )
                  })}
                </Stack>
              </Box>
            ) : null}
              </>
            )}
          </Stack>
        )}
      </Modal>
      <ExportModal
        opened={exportOpen}
        onClose={closeExport}
        title="导出世界书"
        defaultName={exportCfg?.defaultName}
        makeBlob={exportCfg?.makeBlob}
        description="可修改导出文件名；点击导出后按系统提示选择保存到指定位置。"
        onDone={(_ok, m) => setMsg(m)}
      />
    </Stack>
  )
}

/* ======================== 文件夹 ======================== */

function FolderManager({ kind }: { kind: 'wb' | 'cc' }) {
  const folders = useAtomValue(foldersAtom)
  const [opened, { open, close }] = useDisclosure(false)
  const [name, setName] = useState('')
  const list = folders.filter((f) => f.kind === kind)
  return (
    <>
      <Button size="xs" variant="default" onClick={open}>管理文件夹</Button>
      <Modal opened={opened} onClose={close} title="文件夹管理" size="sm">
        <Stack gap="xs">
          {list.map((f) => (
            <Group key={f.id} justify="space-between">
              <Text size="sm">{f.name}</Text>
              <Button size="compact-xs" color="red" variant="subtle" onClick={() => void removeFolderById(f.id)}>删除</Button>
            </Group>
          ))}
          <Group>
            <TextInput placeholder="新文件夹名" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
            <Button
              size="xs"
              onClick={async () => {
                if (!name.trim()) return
                await upsertFolder({ id: uuidv4(), name: name.trim(), kind })
                setName('')
              }}
            >
              添加
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

async function removeFolderById(id: string) {
  const { removeFolder } = await import('../store')
  await removeFolder(id)
}

/* ======================== 人物卡 ======================== */

export function CharactersTab() {
  const items = useAtomValue(characterCardsAtom)
  const [editing, setEditing] = useState<CharacterCard | null>(null)
  const [opened, { open, close }] = useDisclosure(false)
  const [msg, setMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [mergeOpen, { open: openMerge, close: closeMerge }] = useDisclosure(false)
  const [presetMerge, setPresetMerge] = useState<CharacterCard[] | null>(null)
  const folders = useAtomValue(foldersAtom)
  const ccFolders = folders.filter((f) => f.kind === 'cc')
  const [exportCfg, setExportCfg] = useState<ExportModalConfig | null>(null)
  const [exportOpen, { open: openExport, close: closeExport }] = useDisclosure(false)
  const bs = useBatchSelect(items)

  const openNew = () => {
    const card = createEmptyCharacterCard()
    card.id = uuidv4()
    card.name = ''
    setEditing(card)
    open()
  }
  const openEdit = (c: CharacterCard) => {
    setEditing({ ...c, relationships: c.relationships.map((r) => ({ ...r })), customAttributes: c.customAttributes.map((a) => ({ ...a })) })
    open()
  }
  const save = async () => {
    if (!editing) return
    await addOrUpdateCharacterCard(editing)
    close()
  }

  const doExport = () => {
    setExportCfg({ defaultName: 'chatbox-mod-charactercards.json', makeBlob: () => new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }) })
    openExport()
  }

  // 酒馆/CCv3 卡 → 内部人物卡落库（PNG 与 JSON 共用；PNG 额外带头像）
  const importTavernCard = async (tavern: TavernCardData, avatar?: string) => {
    const m = mapTavernCardToMod(tavern)
    const card = createEmptyCharacterCard()
    card.name = m.fields.name
    card.backgroundStory = m.fields.backgroundStory
    card.personalityType = m.fields.personalityType
    card.customAttributes = m.fields.customAttributes
    card.characterBook = m.bookEntries.map((e) => ({
      id: uuidv4(),
      name: e.name,
      keywords: e.keywords,
      content: e.content,
      comment: e.comment,
      triggerMode: e.triggerMode,
      depth: e.depth,
      order: e.order,
      enabled: e.enabled,
    }))
    card.avatar = avatar
    await addOrUpdateCharacterCard(card)
    return card
  }

  // 内部格式数组 → 逐张落库（数组 / 单卡 / 导出包）
  const importCardsFromArray = async (arr: unknown[]) => {
    let n = 0
    for (const raw of arr) {
      const it = raw as Partial<CharacterCard>
      if (!it || typeof it.name !== 'string' || !it.name.trim()) continue
      const card = createEmptyCharacterCard()
      card.id = typeof it.id === 'string' && it.id ? it.id : uuidv4()
      card.name = it.name.trim()
      card.age = typeof it.age === 'string' ? it.age : ''
      card.gender = typeof it.gender === 'string' ? it.gender : ''
      card.occupation = typeof it.occupation === 'string' ? it.occupation : ''
      card.appearance = typeof it.appearance === 'string' ? it.appearance : ''
      card.height = typeof it.height === 'string' ? it.height : ''
      card.weight = typeof it.weight === 'string' ? it.weight : ''
      card.distinguishingFeatures = typeof it.distinguishingFeatures === 'string' ? it.distinguishingFeatures : ''
      card.personalityType = typeof it.personalityType === 'string' ? it.personalityType : ''
      card.strengths = typeof it.strengths === 'string' ? it.strengths : ''
      card.weaknesses = typeof it.weaknesses === 'string' ? it.weaknesses : ''
      card.hobbies = typeof it.hobbies === 'string' ? it.hobbies : ''
      card.backgroundStory = typeof it.backgroundStory === 'string' ? it.backgroundStory : ''
      card.relationships = Array.isArray(it.relationships) ? it.relationships.map((r) => ({ targetName: String(r?.targetName ?? ''), relation: String(r?.relation ?? ''), description: String(r?.description ?? '') })) : []
      card.customAttributes = Array.isArray(it.customAttributes) ? it.customAttributes.map((a) => ({ key: String(a?.key ?? ''), value: String(a?.value ?? '') })) : []
      card.avatar = typeof it.avatar === 'string' ? it.avatar : undefined
      card.folderId = typeof it.folderId === 'string' ? it.folderId : undefined
      card.enabled = it.enabled !== false
      await addOrUpdateCharacterCard(card)
      n++
    }
    return n
  }

  // 导入 JSON 文本（CCv3 / 酒馆 / 内部格式统一识别，A 阶段智能导入）
  const importCardText = async (text: string) => {
    const fmt = detectCardJsonFormat(text)
    if (fmt === 'ccv3' || fmt === 'tavern') {
      const tavern = parseCharacterCardJson(text)
      if (tavern) {
        const card = await importTavernCard(tavern)
        setMsg(`导入完成：1 张人物卡「${card.name}」${card.characterBook.length > 0 ? `（含 ${card.characterBook.length} 条世界书条目）` : ''}`)
        return true
      }
    }
    const arr = parseJsonArrayText(text)
    const n = await importCardsFromArray(arr)
    setMsg(arr.length === 0 ? '导入 0 张：文件中没有可识别的人物卡（支持数组 / 单卡 / 导出包 / CCv3·酒馆 JSON / PNG 人物卡格式）' : `导入完成：${n} 张人物卡`)
    return arr.length > 0
  }

  const doImport = async (file: File | null) => {
    if (!file) return
    setImporting(true)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      const isPng = isPngBytes(buf)
      if (isPng) {
        // PNG 人物卡：解析 tEXt 内嵌数据（ccv3 / chara），立绘存头像
        const tavern = parseCharacterCardPng(buf)
        if (!tavern) {
          // A 阶段：失败分级诊断，明确原因与建议
          const d = diagnosePngCard(buf)
          const hint =
            d.branch === 'no-chunk'
              ? '这个 PNG 里没有识别到人物卡数据——疑似被聊天/相册「保存图片」重编码剥掉了数据块，请改用「文件」方式传输原始 PNG。'
              : d.branch === 'no-keyword'
                ? `这个 PNG 有 ${d.chunkCount ?? 0} 个文本块，但没有标准的 ccv3/chara 人物卡数据，不是人物卡 PNG。`
                : d.branch === 'json-error'
                  ? `PNG 里的人物卡数据损坏（${d.error}），无法解析。`
                  : d.branch === 'no-name'
                    ? 'PNG 里有人物卡数据，但缺少角色名（name），无法导入。'
                    : '这个 PNG 里没有识别到人物卡数据（需要酒馆/Chub 标准的 ccv3 或 chara 数据块）。'
          setMsg(`导入 0 张：${hint}`)
          return
        }
        const card = await importTavernCard(tavern, await pngToAvatarDataUrl(file))
        setMsg(`导入完成：1 张 PNG 人物卡「${card.name}」${card.characterBook.length > 0 ? `（含 ${card.characterBook.length} 条世界书条目）` : ''}`)
        return
      }
      // JSON：统一格式识别分流（CCv3 包装 / 顶层酒馆 / 内部格式）
      const text = await file.text()
      await importCardText(text)
    } catch (e) {
      setMsg(`导入失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setImporting(false)
    }
  }

  // 粘贴 JSON 导入（绕开文件传输重编码，最稳路径）
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const doPasteImport = async () => {
    if (!pasteText.trim()) return
    setImporting(true)
    try {
      await importCardText(pasteText)
      setPasteText('')
    } catch (e) {
      setMsg(`导入失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setImporting(false)
    }
  }

  const selectedIds = [...bs.sel]

  // 搜索 + 分类过滤
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('all')
  const [newFolderOpen, { open: openNewFolder, close: closeNewFolder }] = useDisclosure(false)
  const filtered = useMemo(() => {
    let list = items
    if (cat === 'none') list = list.filter((c) => !c.folderId)
    else if (cat !== 'all') list = list.filter((c) => c.folderId === cat)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((c) =>
        [c.name, c.occupation, c.personalityType, c.age, c.gender, c.backgroundStory].join(' ').toLowerCase().includes(q),
      )
    }
    return list
  }, [items, query, cat])

  // 导出选中
  const doExportSel = () => {
    const list = items.filter((c) => selectedIds.includes(c.id))
    setExportCfg({ defaultName: 'chatbox-mod-charactercards-selected.json', makeBlob: () => new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }) })
    openExport()
    bs.clear()
  }
  // 全选/取消（按当前过滤结果）
  const toggleAll = () => {
    const ids = filtered.map((c) => c.id)
    if (bs.sel.size === ids.length && ids.length > 0) bs.clear()
    else bs.setMany(ids)
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Text c="dimmed" size="sm">{bs.mode ? `已选 ${bs.sel.size}/${filtered.length} 张` : (msg ? msg : `共 ${items.length} 张人物卡`)}</Text>
        <Group gap={4}>
          <Tooltip label="选择人物卡文件（JSON / PNG 人物卡，导入合并）">
            <label>
              <Button component="span" size="xs" variant="default" loading={importing}>导入</Button>
              <input type="file" accept="application/json,image/png" style={{ display: 'none' }} onChange={(e) => void doImport(e.target.files?.[0] ?? null)} />
            </label>
          </Tooltip>
          <Button size="xs" variant="default" onClick={() => setPasteOpen((v) => !v)}>粘贴导入</Button>
          <Button size="xs" variant="default" onClick={() => void doExport()}>导出</Button>
          {bs.mode ? (
            <Button size="xs" variant="filled" color="green" onClick={() => { bs.setMode(false); bs.clear() }}>完成</Button>
          ) : (
            <Button size="xs" variant="default" onClick={() => { bs.setMode(true); bs.clear() }}>多选</Button>
          )}
          {!bs.mode && (
            <Button size="xs" variant="default" onClick={() => { bs.setMode(true); bs.setMany(filtered.map((c) => c.id)) }}>全选</Button>
          )}
          {!bs.mode && (
            <Button size="xs" variant="default" leftSection={<IconGitMerge size={14} />} onClick={() => { setPresetMerge(null); openMerge() }}>合并同名</Button>
          )}
          {!bs.mode && <Button size="xs" onClick={openNew}>+ 新建人物卡</Button>}
        </Group>
      </Group>
      {pasteOpen && (
        <Stack gap={6}>
          <Textarea
            size="xs"
            autosize
            minRows={3}
            maxRows={8}
            placeholder="粘贴 CCv3 / 酒馆 JSON 卡文本（或内部数组 / 单卡 / 导出包 JSON），绕开文件传输重编码"
            value={pasteText}
            onChange={(e) => setPasteText(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button size="compact-xs" variant="default" onClick={() => setPasteOpen(false)}>取消</Button>
            <Button size="compact-xs" color="green" loading={importing} onClick={() => void doPasteImport()}>粘贴导入</Button>
          </Group>
        </Stack>
      )}
      <TextInput
        placeholder="按名称、职业、性格等搜索……"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        leftSection={<IconSearch size={14} />}
      />
      <CategoryTabs
        kind="cc"
        folders={ccFolders}
        items={items}
        active={cat}
        onChange={setCat}
        onNewFolder={() => { setCat('all'); openNewFolder() }}
      />
      <NewFolderModal opened={newFolderOpen} onClose={closeNewFolder} kind="cc" onCreated={(f) => setCat(f.id)} />
      {bs.mode && (
        <>
          <Grid columns={3} gutter="xs">
            <Grid.Col span={1}>
              <Button size="xs" variant={bs.sel.size === filtered.length && filtered.length > 0 ? 'filled' : 'default'} onClick={toggleAll} style={{ width: '100%' }}>全选</Button>
            </Grid.Col>
            <Grid.Col span={1}><Button size="xs" variant="default" leftSection={<IconCircleCheck size={14} />} style={{ width: '100%' }} onClick={() => { void setItemsEnabled('cc', selectedIds, true); bs.clear() }}>启用所选</Button></Grid.Col>
            <Grid.Col span={1}><Button size="xs" variant="default" leftSection={<IconCircleX size={14} />} style={{ width: '100%' }} onClick={() => { void setItemsEnabled('cc', selectedIds, false); bs.clear() }}>禁用所选</Button></Grid.Col>
          </Grid>
          <Box style={{ marginTop: 6 }}><MoveFolderSelect kind="cc" folders={ccFolders} ids={selectedIds} onMoved={() => bs.clear()} /></Box>
          <Grid columns={2} gutter="xs" style={{ marginTop: 6 }}>
            <Grid.Col span={1}>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconGitMerge size={14} />}
                disabled={selectedIds.length < 2}
                style={{ width: '100%' }}
                onClick={() => {
                  setPresetMerge(items.filter((c) => selectedIds.includes(c.id)))
                  openMerge()
                }}
              >
                合并人物卡
              </Button>
            </Grid.Col>
            <Grid.Col span={1}><Button size="xs" variant="default" leftSection={<IconDownload size={14} />} style={{ width: '100%' }} onClick={() => void doExportSel()}>导出所选</Button></Grid.Col>
          </Grid>
          <Button size="xs" color="red" variant="filled" leftSection={<IconTrash size={14} />} style={{ width: '100%', marginTop: 6 }} onClick={async () => {
            const ok = await NiceModal.show('confirm', { title: '删除人物卡', message: `确定删除选中的 ${selectedIds.length} 张人物卡？删除不可撤销（可用设置/导出中的自动更新备份恢复）。`, confirmText: '删除', danger: true })
            if (ok) { void removeItems('cc', selectedIds); bs.clear() }
          }}>删除所选</Button>
        </>
      )}
      <Stack gap="xs">
        {filtered.map((c) => (
          <Card
            key={c.id}
            withBorder
            padding="sm"
            style={bs.mode ? { borderColor: bs.sel.has(c.id) ? 'var(--chatbox-brand-color, #2563eb)' : undefined, cursor: 'pointer' } : undefined}
            onClick={bs.mode ? () => bs.toggle(c.id) : undefined}
          >
            <Group justify="space-between" wrap="nowrap">
              {bs.mode && <Checkbox checked={bs.sel.has(c.id)} onChange={() => bs.toggle(c.id)} aria-label={c.name} size="sm" />}
              {c.avatar ? (
                <Box
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: 'rgba(127,127,127,0.12)',
                  }}
                >
                  <img src={c.avatar} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </Box>
              ) : null}
              <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
                {/* 行1：姓名 + 职业 + 文件夹 */}
                <Group gap="xs" wrap="wrap">
                  <Text fw={600} size="sm">{c.name}</Text>
                  {c.occupation ? <Badge size="xs" variant="light" color="blue">{c.occupation}</Badge> : null}
                  {c.folderId ? <Badge size="xs" variant="outline">{ccFolders.find((f) => f.id === c.folderId)?.name ?? '未知'}</Badge> : null}
                </Group>
                {/* 行2：基础属性小标签 */}
                <Group gap={4} wrap="wrap">
                  {c.age ? <Badge size="xs" variant="default" radius="sm">{c.age}</Badge> : null}
                  {c.gender ? <Badge size="xs" variant="default" radius="sm">{c.gender}</Badge> : null}
                  {c.height ? <Badge size="xs" variant="default" radius="sm">{c.height}</Badge> : null}
                  {c.weight ? <Badge size="xs" variant="default" radius="sm">{c.weight}</Badge> : null}
                  {c.personalityType ? <Badge size="xs" variant="default" radius="sm" color="violet">{c.personalityType}</Badge> : null}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{c.backgroundStory || '（暂无背景故事）'}</Text>
                {c.relationships.length > 0 ? (
                  <Group gap={4} wrap="wrap">
                    {c.relationships.slice(0, 3).map((r, i) => (
                      <Badge key={i} size="xs" variant="filled" color="gray" radius="sm">
                        {r.targetName} · {r.relation}
                      </Badge>
                    ))}
                    {c.relationships.length > 3 ? <Text size="xs" c="dimmed">+{c.relationships.length - 3} 更多</Text> : null}
                  </Group>
                ) : null}
              </Stack>
              {!bs.mode && (
                <Group gap={4} wrap="nowrap">
                  <Switch checked={c.enabled !== false} size="xs" onClick={(e) => e.stopPropagation()} onChange={(e) => void toggleCharacterCard(c.id, e.currentTarget.checked)} />
                  <Button size="compact-xs" variant="subtle" onClick={(e) => { e.stopPropagation(); openEdit(c) }}>编辑</Button>
                  <Button size="compact-xs" variant="subtle" color="red" onClick={async (e) => {
                    e.stopPropagation()
                    const ok = await NiceModal.show('confirm', { title: '删除人物卡', message: `确定删除「${c.name}」？删除不可撤销（可用设置/导出中的自动更新备份恢复）。`, confirmText: '删除', danger: true })
                    if (ok) void removeCharacterCard(c.id)
                  }}>删除</Button>
                </Group>
              )}
            </Group>
          </Card>
        ))}
        {filtered.length === 0 ? <Text c="dimmed" size="sm">{items.length === 0 ? '还没有人物卡，点击右上角新建。' : '当前筛选条件下没有匹配的人物卡。'}</Text> : null}
      </Stack>

      <Modal opened={opened} onClose={close} title="编辑人物卡" size="lg">
        {editing && <CharacterCardEditor card={editing} onChange={setEditing} folders={ccFolders} />}
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={close}>取消</Button>
          <Button onClick={() => void save()}>保存</Button>
        </Group>
      </Modal>

      <MergeCardsModal
        items={items}
        presetCards={presetMerge}
        opened={mergeOpen}
        onClose={() => { closeMerge(); setPresetMerge(null) }}
        folderNameOf={(id) => ccFolders.find((f) => f.id === id)?.name}
      />
      <ExportModal
        opened={exportOpen}
        onClose={closeExport}
        title="导出人物卡"
        defaultName={exportCfg?.defaultName}
        makeBlob={exportCfg?.makeBlob}
        description="可修改导出文件名；点击导出后按系统提示选择保存到指定位置。"
        onDone={(_ok, m) => setMsg(m)}
      />
    </Stack>
  )
}

/* ======================== 合并同名人物卡 ======================== */

const CC_FIELD_LABELS: Record<string, string> = {
  age: '年龄', gender: '性别', occupation: '职业', appearance: '外貌', height: '身高', weight: '体重',
  distinguishingFeatures: '特征', personalityType: '性格', strengths: '优点', weaknesses: '缺点',
  hobbies: '爱好', backgroundStory: '背景故事', enabled: '启用状态', folderId: '文件夹',
  relationships: '关系', customAttributes: '自定义属性',
}

interface MergeConflict {
  field: string
  label: string
  /** 各卡的值展示文本 */
  values: string[]
  /** 是否支持「合并去重」（数组字段） */
  multi?: boolean
}

function MergeCardsModal(props: {
  items: CharacterCard[]
  /** 传入则进入「合并选中卡」模式（跳过同名分组选择，直接以该列表为合并组） */
  presetCards?: CharacterCard[] | null
  opened: boolean
  onClose: () => void
  folderNameOf: (id?: string) => string | undefined
}) {
  const { items, opened, onClose, folderNameOf, presetCards } = props
  const [groupIdx, setGroupIdx] = useState(0)
  const [choice, setChoice] = useState<Record<string, number | 'merge'>>({})
  const [deleteOld, setDeleteOld] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 同名分组（名字完全相同的组，≥2 张）；合并选中模式不分组
  const groups = useMemo(() => {
    if (presetCards && presetCards.length > 1) {
      return [{ name: presetCards[0].name || '选中人物卡', cards: presetCards }]
    }
    const m = new Map<string, CharacterCard[]>()
    for (const c of items) {
      const k = c.name.trim()
      if (!k) continue
      const g = m.get(k) ?? []
      g.push(c)
      m.set(k, g)
    }
    return [...m.entries()]
      .filter(([, g]) => g.length > 1)
      .map(([name, cards]) => ({ name, cards }))
  }, [items, presetCards])

  const group = groups[groupIdx] ?? null

  // 冲突字段：组内各卡取值不一致的字段
  const conflicts = useMemo<MergeConflict[]>(() => {
    if (!group) return []
    const cards = group.cards
    const out: MergeConflict[] = []
    const scalars = ['age', 'gender', 'occupation', 'appearance', 'height', 'weight', 'distinguishingFeatures', 'personalityType', 'strengths', 'weaknesses', 'hobbies', 'backgroundStory'] as const
    for (const f of scalars) {
      const vals = cards.map((c) => String(c[f] ?? '').trim())
      if (new Set(vals).size > 1) out.push({ field: f, label: CC_FIELD_LABELS[f] ?? f, values: vals.map((v) => v || '（空）') })
    }
    const enabledVals = cards.map((c) => (c.enabled !== false ? '启用' : '停用'))
    if (new Set(enabledVals).size > 1) out.push({ field: 'enabled', label: '启用状态', values: enabledVals })
    const folderVals = cards.map((c) => folderNameOf(c.folderId) ?? '无文件夹')
    if (new Set(folderVals).size > 1) out.push({ field: 'folderId', label: '文件夹', values: folderVals })
    for (const f of ['relationships', 'customAttributes'] as const) {
      const sigs = cards.map((c) => JSON.stringify(c[f] ?? []))
      if (new Set(sigs).size > 1) {
        out.push({
          field: f,
          label: CC_FIELD_LABELS[f] ?? f,
          values: cards.map((c) => (c[f]?.length ? `${(c[f] as unknown[]).length} 条` : '（空）')),
          multi: true,
        })
      }
    }
    return out
  }, [group, folderNameOf])

  const doMerge = async () => {
    if (!group || busy) return
    setBusy(true)
    setErr('')
    try {
      const cards = group.cards
      const base = { ...cards[0] }
      const rec = base as unknown as Record<string, unknown>
      for (const cf of conflicts) {
        const sel = choice[cf.field]
        if (cf.multi) {
          if (sel === 'merge') {
            const merged = cards.flatMap((c) => (c[cf.field as 'relationships' | 'customAttributes'] ?? []) as unknown[])
            const seen = new Set<string>()
            rec[cf.field] = merged.filter((x) => {
              const k = JSON.stringify(x)
              if (seen.has(k)) return false
              seen.add(k)
              return true
            })
          } else {
            const idx = typeof sel === 'number' ? sel : 0
            rec[cf.field] = cards[idx][cf.field as 'relationships' | 'customAttributes'] ?? []
          }
        } else {
          const idx = typeof sel === 'number' ? sel : 0
          rec[cf.field] = cards[idx][cf.field as keyof CharacterCard]
        }
      }
      rec.updatedAt = Date.now()
      await addOrUpdateCharacterCard(base)
      if (deleteOld) {
        for (const c of cards.slice(1)) await removeCharacterCard(c.id)
      }
      onClose()
      setChoice({})
      setGroupIdx(0)
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const isPreset = !!(presetCards && presetCards.length > 1)

  return (
    <Modal opened={opened} onClose={() => { onClose(); setGroupIdx(0); setChoice({}) }} title={isPreset ? `合并选中人物卡（${groups[0]?.cards.length ?? 0} 张）` : `合并同名人物卡（${groups.length} 组）`} size="lg">
      {groups.length === 0 ? (
        <Text c="dimmed" size="sm">没有可合并的人物卡。同名模式按「姓名完全相同」检索；多选模式请先勾选 ≥2 张卡再点「合并选中」。</Text>
      ) : (
        <Stack gap="sm">
          {!isPreset && (
            <Select
              label="同名组合"
              data={groups.map((g, i) => ({ value: String(i), label: `${g.name}（${g.cards.length} 张）` }))}
              value={String(groupIdx)}
              onChange={(v) => { setGroupIdx(Number(v) || 0); setChoice({}) }}
            />
          )}
          {group && (
            <>
              <Text size="xs" c="dimmed">
                合并基准为「卡1」，冲突字段请选择保留哪张卡的值；关系/自定义属性可选择「合并去重」。
              </Text>
              {conflicts.length === 0 ? (
                <Alert variant="light" color="teal" title="无冲突字段">
                  该组人物卡字段完全一致，可直接合并（去重后仅保留一张）。
                </Alert>
              ) : (
                conflicts.map((cf) => (
                  <Box key={cf.field} style={{ border: '1px solid var(--chatbox-border-primary, #e5e7eb)', borderRadius: 10, padding: 10 }}>
                    <Text fw={600} size="sm" mb={6}>{cf.label}</Text>
                    <Group gap={6} wrap="wrap">
                      {cf.values.map((v, i) => {
                        const active = choice[cf.field] === i
                        return (
                          <UnstyledButton
                            key={i}
                            onClick={() => setChoice({ ...choice, [cf.field]: i })}
                            style={{
                              border: active ? '1.5px solid var(--chatbox-brand-color, #2563eb)' : '1px solid var(--chatbox-border-primary, #e5e7eb)',
                              borderRadius: 8,
                              padding: '4px 8px',
                              fontSize: 12,
                              background: active ? 'var(--chatbox-background-brand-secondary, #eff6ff)' : 'transparent',
                            }}
                          >
                            卡{i + 1}：{v}
                          </UnstyledButton>
                        )
                      })}
                      {cf.multi && (
                        <UnstyledButton
                          onClick={() => setChoice({ ...choice, [cf.field]: 'merge' })}
                          style={{
                            border: choice[cf.field] === 'merge' ? '1.5px solid var(--chatbox-brand-color, #2563eb)' : '1px dashed var(--chatbox-border-primary, #cbd5e1)',
                            borderRadius: 8,
                            padding: '4px 8px',
                            fontSize: 12,
                            background: choice[cf.field] === 'merge' ? 'var(--chatbox-background-brand-secondary, #eff6ff)' : 'transparent',
                          }}
                        >
                          合并去重
                        </UnstyledButton>
                      )}
                    </Group>
                  </Box>
                ))
              )}
              <Divider />
              <Switch label="合并后删除旧卡（保留卡1）" checked={deleteOld} onChange={(e) => setDeleteOld(e.currentTarget.checked)} />
              {err ? <Text size="sm" c="red">{err}</Text> : null}
              <Group justify="flex-end">
                <Button variant="subtle" onClick={onClose}>取消</Button>
                <Button onClick={() => void doMerge()} loading={busy} leftSection={<IconGitMerge size={14} />}>合并</Button>
              </Group>
            </>
          )}
        </Stack>
      )}
    </Modal>
  )
}

function CharacterCardEditor({ card, onChange, folders }: { card: CharacterCard; onChange: (c: CharacterCard) => void; folders: ModFolder[] }) {
  const set = (patch: Partial<CharacterCard>) => onChange({ ...card, ...patch })
  const [freeze, setFreeze] = useState(false)
  // 关联事件区：展示/添加/单条冻结
  const events = card.associatedEvents ?? []
  const setEvents = (list: CharacterCard['associatedEvents']) => set({ associatedEvents: list })
  const [addingEvent, setAddingEvent] = useState(false)
  const [newEventContent, setNewEventContent] = useState('')
  const [newEventKws, setNewEventKws] = useState('')
  const fields = [
    { field: 'appearance', label: '外貌', content: card.appearance },
    { field: 'distinguishingFeatures', label: '显著特征', content: card.distinguishingFeatures },
    { field: 'personalityType', label: '性格类型', content: card.personalityType },
    { field: 'strengths', label: '优点', content: card.strengths },
    { field: 'weaknesses', label: '缺点', content: card.weaknesses },
    { field: 'hobbies', label: '爱好', content: card.hobbies },
    { field: 'backgroundStory', label: '背景故事', content: card.backgroundStory },
  ]
  return (
    <Stack gap="sm" className="cc-editor">
      {/* 编辑弹窗排版优化：整体字号调小（框大小不变），避免长文本/窄栏截断 */}
      <style>{`
        .cc-editor input, .cc-editor textarea { font-size: 12px; }
        .cc-editor label { font-size: 11px; }
        .cc-editor .mantine-InputWrapper-label { font-size: 11px; }
        .cc-editor .mantine-Input-section { font-size: 11px; }
        .cc-editor .mantine-Switch-label { font-size: 12px; }
        .cc-editor .mantine-Button-label { font-size: 12px; }
      `}</style>
      <Switch
        label="冻结模式（整段选择冻结）"
        checked={freeze}
        onChange={(e) => setFreeze(e.currentTarget.checked)}
        size="xs"
      />
      {freeze ? (
        <FreezePicker
          fields={fields}
          frozenTexts={card.frozenTexts}
          onFrozenChange={(list) => set({ frozenTexts: list })}
          onExit={() => setFreeze(false)}
        />
      ) : (
        <>
      {/* 基本信息 */}
      <Divider label="基本信息" labelPosition="left" />
      <Group grow>
        <TextInput label="姓名" value={card.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <TextInput label="年龄" value={card.age} onChange={(e) => set({ age: e.currentTarget.value })} />
        <TextInput label="性别" value={card.gender} onChange={(e) => set({ gender: e.currentTarget.value })} />
      </Group>
      <Group grow>
        <TextInput label="职业" value={card.occupation} onChange={(e) => set({ occupation: e.currentTarget.value })} />
        <TextInput label="身高" value={card.height} onChange={(e) => set({ height: e.currentTarget.value })} />
        <TextInput label="体重" value={card.weight} onChange={(e) => set({ weight: e.currentTarget.value })} />
      </Group>
      {/* 外貌与性格 */}
      <Divider label="外貌与性格" labelPosition="left" />
      <FrozenTextarea label="外貌" field="appearance" value={card.appearance} onChange={(v) => set({ appearance: v })} frozenTexts={card.frozenTexts} onFrozenChange={(list) => set({ frozenTexts: list })} minRows={2} />
      <FrozenTextarea label="显著特征" field="distinguishingFeatures" value={card.distinguishingFeatures} onChange={(v) => set({ distinguishingFeatures: v })} frozenTexts={card.frozenTexts} onFrozenChange={(list) => set({ frozenTexts: list })} minRows={2} />
      <FrozenTextarea label="性格类型" field="personalityType" value={card.personalityType} onChange={(v) => set({ personalityType: v })} frozenTexts={card.frozenTexts} onFrozenChange={(list) => set({ frozenTexts: list })} minRows={2} />
      {/* 优点/缺点：上下排列（不并排），全宽显示避免截断 */}
      <FrozenTextarea label="优点" field="strengths" value={card.strengths} onChange={(v) => set({ strengths: v })} frozenTexts={card.frozenTexts} onFrozenChange={(list) => set({ frozenTexts: list })} minRows={2} />
      <FrozenTextarea label="缺点" field="weaknesses" value={card.weaknesses} onChange={(v) => set({ weaknesses: v })} frozenTexts={card.frozenTexts} onFrozenChange={(list) => set({ frozenTexts: list })} minRows={2} />
      <FrozenTextarea label="爱好" field="hobbies" value={card.hobbies} onChange={(v) => set({ hobbies: v })} frozenTexts={card.frozenTexts} onFrozenChange={(list) => set({ frozenTexts: list })} minRows={2} />
      <FrozenTextarea
        label="背景故事"
        field="backgroundStory"
        value={card.backgroundStory}
        onChange={(v) => set({ backgroundStory: v })}
        frozenTexts={card.frozenTexts}
        onFrozenChange={(list) => set({ frozenTexts: list })}
        minRows={4}
      />
      {/* 关系 */}
      <Divider label="关系" labelPosition="left" />
      {card.relationships.map((r, i) => (
        <Group key={i} grow>
          <TextInput placeholder="对象" value={r.targetName} onChange={(e) => set({ relationships: card.relationships.map((x, j) => (j === i ? { ...x, targetName: e.currentTarget.value } : x)) })} />
          <TextInput placeholder="关系" value={r.relation} onChange={(e) => set({ relationships: card.relationships.map((x, j) => (j === i ? { ...x, relation: e.currentTarget.value } : x)) })} />
          <ActionIcon color="red" variant="subtle" onClick={() => set({ relationships: card.relationships.filter((_, j) => j !== i) })}>✕</ActionIcon>
        </Group>
      ))}
      <Button size="compact-xs" variant="subtle" onClick={() => set({ relationships: [...card.relationships, { targetName: '', relation: '' }] })}>+ 添加关系</Button>
      {/* 自定义属性 */}
      <Divider label="自定义属性" labelPosition="left" />
      {card.customAttributes.map((a, i) => (
        <Group key={i} grow>
          <TextInput placeholder="属性名" value={a.key} onChange={(e) => set({ customAttributes: card.customAttributes.map((x, j) => (j === i ? { ...x, key: e.currentTarget.value } : x)) })} />
          <TextInput placeholder="属性值" value={a.value} onChange={(e) => set({ customAttributes: card.customAttributes.map((x, j) => (j === i ? { ...x, value: e.currentTarget.value } : x)) })} />
          <ActionIcon color="red" variant="subtle" onClick={() => set({ customAttributes: card.customAttributes.filter((_, j) => j !== i) })}>✕</ActionIcon>
        </Group>
      ))}
      <Button size="compact-xs" variant="subtle" onClick={() => set({ customAttributes: [...card.customAttributes, { key: '', value: '' }] })}>+ 添加属性</Button>
      {/* 关联事件区（角色知识库：剧情进展累积、关键词触发注入、可单条冻结） */}
      <Divider label="角色知识库（CharacterBook）" labelPosition="left" />
      <Text size="xs" c="dimmed">角色专属事件与记忆，跟随人物卡；勾选关键词触发后，对话命中才注入上下文。</Text>
      {events.length === 0 ? (
        <Box style={{ border: '1px dashed #d0d0d0', borderRadius: 6, padding: '10px 12px', background: '#fafafa' }}>
          <Text size="xs" c="dimmed">暂无条目。角色的个人事件（剧情进展、经历）建议放这里，而不是全局世界书。</Text>
        </Box>
      ) : (
        <Stack gap={4}>
          {events.slice().reverse().map((e) => (
            <Box key={e.id} style={{ border: e.frozen ? '1px solid #f0c0c0' : '1px solid #e0e0e0', borderRadius: 4, padding: '4px 6px', background: e.frozen ? '#fff4f2' : '#fff' }}>
              <Flex justify="space-between" align="center" gap="xs">
                <Text size="xs" fw={600} style={{ flex: 1, minWidth: 0 }}>{e.roleName}</Text>
                <Text size="xs" c="dimmed">{new Date(e.t).toLocaleString()}</Text>
                <ActionIcon size="xs" color={e.frozen ? 'red' : 'gray'} variant="subtle" title={e.frozen ? '已冻结（AI 不改）' : '未冻结'} onClick={() => setEvents(events.map((x) => (x.id === e.id ? { ...x, frozen: !x.frozen } : x)))}>{e.frozen ? '🔒' : '🔓'}</ActionIcon>
                <ActionIcon size="xs" color="red" variant="subtle" onClick={() => setEvents(events.filter((x) => x.id !== e.id))}>✕</ActionIcon>
              </Flex>
              <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>{e.content}</Text>
              {e.keywords && e.keywords.length > 0 ? <Text size="xs" c="blue">触发词: {e.keywords.join(' / ')}</Text> : null}
            </Box>
          ))}
        </Stack>
      )}
      {addingEvent ? (
        <>
          <Textarea size="xs" autosize minRows={2} placeholder="事件内容（一句话剧情进展）" value={newEventContent} onChange={(ev) => setNewEventContent(ev.currentTarget.value)} />
          <TextInput size="xs" placeholder="触发关键词（逗号分隔，对话命中才注入上下文）" value={newEventKws} onChange={(ev) => setNewEventKws(ev.currentTarget.value)} />
          <Group>
            <Button size="compact-xs" color="chatbox-brand" onClick={() => {
              const content = newEventContent.trim()
              if (!content) return
              setEvents([...events, {
                id: uuidv4(),
                roleName: card.name,
                content,
                keywords: newEventKws.split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
                t: Date.now(),
              }])
              setNewEventContent('')
              setNewEventKws('')
              setAddingEvent(false)
            }}>添加</Button>
            <Button size="compact-xs" variant="subtle" onClick={() => setAddingEvent(false)}>取消</Button>
          </Group>
        </>
      ) : (
        <Group justify="space-between" align="center">
          <Button size="compact-xs" variant="subtle" onClick={() => setAddingEvent(true)}>+ 添加条目</Button>
          <Switch
            label="启用（注入到对话上下文）"
            checked={card.eventInjectionEnabled !== false}
            onChange={(e) => set({ eventInjectionEnabled: e.currentTarget.checked })}
            size="xs"
          />
        </Group>
      )}
      {/* 归属 */}
      <Divider label="归属" labelPosition="left" />
      <Select
        label="文件夹"
        placeholder="无"
        data={folders.map((f) => ({ value: f.id, label: f.name }))}
        value={card.folderId ?? null}
        onChange={(v) => set({ folderId: v ?? undefined })}
        clearable
      />
      {card.versionHistory.length > 1 && (
        <>
          <Divider label="版本历史（最近 20 份）" labelPosition="left" />
          <Group>
            <Select
              label="恢复到版本"
              placeholder="选择版本"
              data={card.versionHistory.slice(-10).map((v) => ({ value: String(v.version), label: `v${v.version} @ ${new Date(v.timestamp).toLocaleString()}` }))}
              onChange={(v) => {
                if (v) void restoreCharacterCardVersion(card.id, Number(v))
              }}
              style={{ flex: 1 }}
            />
          </Group>
        </>
      )}
        </>
      )}
    </Stack>
  )
}

/* ======================== 会话装载 ======================== */

function BindingTab() {
  const sessionId = useAtomValue(currentSessionIdAtom)
  const { sessionSettings } = useSessionSettings(sessionId && sessionId !== 'new' ? sessionId : null)
  const worldBooks = useAtomValue(worldBooksAtom)
  const characters = useAtomValue(characterCardsAtom)
  const wbIds = useMemo(() => (Array.isArray(sessionSettings.worldBookIds) ? sessionSettings.worldBookIds : []), [sessionSettings.worldBookIds])
  const ccIds = useMemo(() => (Array.isArray(sessionSettings.characterCardIds) ? sessionSettings.characterCardIds : []), [sessionSettings.characterCardIds])

  const toggleWb = async (id: string) => {
    if (!sessionId || sessionId === 'new') return
    const cur = await getBinding(sessionId)
    const next = cur.worldBookIds.includes(id) ? cur.worldBookIds.filter((x) => x !== id) : [...cur.worldBookIds, id]
    await setBinding(sessionId, { ...cur, worldBookIds: next })
  }
  const toggleCc = async (id: string) => {
    if (!sessionId || sessionId === 'new') return
    const cur = await getBinding(sessionId)
    const next = cur.characterCardIds.includes(id) ? cur.characterCardIds.filter((x) => x !== id) : [...cur.characterCardIds, id]
    await setBinding(sessionId, { ...cur, characterCardIds: next })
  }

  return (
    <Stack gap="md">
      <Alert icon={<IconRobot size={16} />} title={`当前会话：${sessionId && sessionId !== 'new' ? sessionId.slice(0, 8) : '（未进入会话，请在会话中打开设置）'}`} variant="light">
        装载的世界书/人物卡会注入到该会话的每次请求系统提示词中。
      </Alert>
      {sessionId && sessionId !== 'new' && (
        <Group>
          <Button size="xs" variant="default" onClick={() => void clearBinding(sessionId)}>清空装载</Button>
        </Group>
      )}
      <Divider label="世界书" />
      <Stack gap="xs">
        {worldBooks.map((w) => (
          <Group key={w.id} justify="space-between">
            <Text size="sm" lineClamp={1} style={{ flex: 1 }}>{w.name}</Text>
            <Switch checked={wbIds.includes(w.id)} size="xs" disabled={!sessionId || sessionId === 'new'} onChange={() => void toggleWb(w.id)} />
          </Group>
        ))}
        {worldBooks.length === 0 ? <Text c="dimmed" size="sm">没有世界书。</Text> : null}
      </Stack>
      <Divider label="人物卡" />
      <Stack gap="xs">
        {characters.map((c) => (
          <Group key={c.id} justify="space-between">
            <Text size="sm" lineClamp={1} style={{ flex: 1 }}>{c.name}</Text>
            <Switch checked={ccIds.includes(c.id)} size="xs" disabled={!sessionId || sessionId === 'new'} onChange={() => void toggleCc(c.id)} />
          </Group>
        ))}
        {characters.length === 0 ? <Text c="dimmed" size="sm">没有人物卡。</Text> : null}
      </Stack>
    </Stack>
  )
}

/* ======================== 自动更新 ======================== */

function AutoUpdateTab() {
  const settings = useAtomValue(modSettingsAtom)
  const [running, setRunning] = useState(isAutoUpdateRunning())
  const [lastResult, setLastResult] = useState<string>('')
  const sessionId = useAtomValue(currentSessionIdAtom)
  // 分析消息数：是否处于快捷档位 / 是否点了「自定义」
  const isPresetRc = ['8', '16', '30', '60'].includes(String(settings.recentMessages))
  const [showCustomRc, setShowCustomRc] = useState(false)
  // 自定义输入草稿（本地编辑，失焦/回车才校验写回，允许自由删改）
  const [rcDraft, setRcDraft] = useState<string>(String(settings.recentMessages))
  useEffect(() => {
    setRcDraft(String(settings.recentMessages))
  }, [settings.recentMessages])
  const commitRc = () => {
    const n = Math.min(100, Math.max(4, Number(rcDraft)))
    if (!Number.isFinite(n) || n < 4 || n > 100) {
      setRcDraft(String(settings.recentMessages))
      return
    }
    setRcDraft(String(n))
    void updateModSettings({ recentMessages: n })
  }

  const runNow = async () => {
    if (!sessionId || sessionId === 'new') {
      setLastResult('请先进入一个会话')
      return
    }
    setRunning(true)
    setLastResult('正在分析…')
    try {
      const r = await maybeAutoUpdateWorldBooks(sessionId, {
        force: true,
        onPreview: (diff) => NiceModal.show('mod-update-preview', { diff }),
      })
      if (r.ok) {
        setLastResult(`完成：世界书 +${r.wbAdd} 改${r.wbUpdate} 删${r.wbRemove}；人物卡 +${r.ccAdd} 改${r.ccUpdate} 删${r.ccRemove}`)
      } else {
        setLastResult(`未完成：${r.error ?? '未知错误'}`)
      }
    } catch (e) {
      setLastResult(`异常：${String((e as Error)?.message ?? e)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Stack gap="md">
      <Alert variant="light" title="自动剧情更新（dynamicWB）">
        回复完成后自动分析最近对话，把新设定/人物增量写回世界书与人物卡库（带备份与日志）。
      </Alert>
      <Switch
        label="启用自动更新"
        checked={settings.autoUpdateEnabled}
        onChange={(e) => void updateModSettings({ autoUpdateEnabled: e.currentTarget.checked })}
      />
      <Switch
        label="写回前要求确认"
        description="开启后自动分析结果需人工确认才落库（推荐）"
        checked={settings.requireConfirm}
        onChange={(e) => void updateModSettings({ requireConfirm: e.currentTarget.checked })}
      />
      <Box>
        <Text size="sm" fw={600}>分析最近消息数</Text>
        <Text size="xs" c="dimmed" mb={6}>
          自动更新分析时取最近多少条消息（用户与 AI 回复都计入）。条数越多分析越全面，但每条 AI 回复后都可能触发一次分析、弹更新预览；觉得弹窗频繁可调小（如 8），觉得漏更新可调大（如 30/60）。
        </Text>
        <SegmentedControl
          size="xs"
          fullWidth
          value={isPresetRc && !showCustomRc ? String(settings.recentMessages) : 'custom'}
          onChange={(v) => {
            if (v === 'custom') setShowCustomRc(true)
            else { setShowCustomRc(false); void updateModSettings({ recentMessages: Number(v) || 16 }) }
          }}
          data={[...['8', '16', '30', '60'].map((n) => ({ label: n, value: n })), { label: '自定义', value: 'custom' }]}
        />
        {showCustomRc || !isPresetRc ? (
          <NumberInput
            mt={6}
            size="xs"
            label="自定义分析消息数（4~100，删除或回车确认）"
            value={rcDraft}
            min={4}
            max={100}
            allowDecimal={false}
            onChange={(v) => setRcDraft(v === null || v === undefined ? '' : String(v))}
            onBlur={commitRc}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRc() } }}
          />
        ) : null}
      </Box>
      <Group>
        <Button onClick={() => void runNow()} loading={running} leftSection={<IconRefresh size={16} />}>立即手动更新</Button>
        <Button variant="default" onClick={() => { forceUnlockAutoUpdate(); setRunning(false); setLastResult('已强制解锁') }}>强制解锁</Button>
      </Group>
      {lastResult ? <Text size="sm">{lastResult}</Text> : null}
      <Divider label="日志（最近 50 条）" />
      <LogViewer limit={50} />
    </Stack>
  )
}

function LogViewer({ limit = 100 }: { limit?: number }) {
  const log = useAtomValue(modLogAtom)
  return (
    <Stack gap={4}>
      {log.slice(0, limit).map((e, i) => (
        <Text key={i} size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          [{new Date(e.t).toLocaleTimeString()}] {e.kind}: {JSON.stringify(e.detail)?.slice(0, 200)}
        </Text>
      ))}
      {log.length === 0 ? <Text c="dimmed" size="sm">暂无日志。</Text> : null}
    </Stack>
  )
}

/* ======================== 小说续写 ======================== */

function NovelTab() {
  const sessionId = useAtomValue(currentSessionIdAtom)
  const [text, setText] = useState('')
  const [chapters, setChapters] = useState<Array<{ title: string; content: string }>>([])
  const [plans, setPlans] = useState<RewritePlan[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // 续写要求（可选）：下一章要写到哪 / 什么情节
  const [extra, setExtra] = useState('')

  /* ---- 原作续改（独立工作台入口） ---- */
  const novels = useAtomValue(novelBooksAtom)
  const [workbenchBookId, setWorkbenchBookId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const novelFileRef = useRef<HTMLInputElement>(null)

  const doNovelImport = async (file: File | null) => {
    if (!file) return
    setImporting(true)
    setImportMsg('')
    try {
      const text = await file.text()
      const r = parseNovelImport(text)
      if (!r.ok) {
        setImportMsg(`导入失败：${r.errors.slice(0, 3).join('；')}${r.errors.length > 3 ? `…等${r.errors.length}条` : ''}`)
        return
      }
      if (r.book) await importNovelBook(r.book)
      const warn = r.warnings.length ? `（${r.warnings.length} 条提示：${r.warnings.slice(0, 2).join('；')}）` : ''
      setImportMsg(`导入成功：${r.book?.bookName}，${r.book?.chapters.length} 章 / ${r.book?.baselines.length} 人物 / ${r.book?.events.length} 事件 / ${r.book?.worldbook.length} 设定${warn}`)
    } catch (e) {
      setImportMsg(`读取失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setImporting(false)
      if (novelFileRef.current) novelFileRef.current.value = ''
    }
  }

  const removeBook = async (bookId: string, name: string) => {
    if (!window.confirm(`删除《${name}》？原著库与改写线将一并移除，不可恢复。`)) return
    await removeNovelBook(bookId)
    if (workbenchBookId === bookId) setWorkbenchBookId(null)
  }

  const doSplit = () => {
    const parts = splitChapters(text)
    setChapters(parts)
    setPlans([])
    setMsg(`切出 ${parts.length} 章`)
  }
  const genPlans = async () => {
    if (!sessionId || sessionId === 'new') {
      setMsg('请先进入一个会话（取其模型设置）')
      return
    }
    setBusy(true)
    setMsg('正在生成改写方案…')
    try {
      const { getSessionSettings } = await import('@/stores/session/session-settings')
      const settings = await getSessionSettings(sessionId)
      const last = chapters.at(-1)
      const context = chapters.slice(0, -1).map((c) => `【${c.title}】${c.content.slice(0, 800)}`).join('\n').slice(0, 8000)
      const plans = await v283GenOptions(settings, context, last?.content ?? '')
      setPlans(plans)
      setMsg(plans.length ? `生成 ${plans.length} 个方案` : '未生成方案')
    } catch (e) {
      setMsg(`失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }
  const rewritePlan = async (plan: RewritePlan) => {
    if (!sessionId || sessionId === 'new') return
    setBusy(true)
    setMsg(`正在按【${plan.title}】改写…`)
    try {
      const { getSessionSettings } = await import('@/stores/session/session-settings')
      const settings = await getSessionSettings(sessionId)
      const last = chapters.at(-1)
      if (!last) return
      const out = await v283Rewrite(settings, last.content, plan)
      setChapters([...chapters.slice(0, -1), { ...last, content: out }])
      setMsg('改写完成（已替换最后一章）')
    } catch (e) {
      setMsg(`失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }
  const pushToSession = async () => {
    setBusy(true)
    setMsg('正在创建小说会话…')
    try {
      const first = chapters[0]
      const sid = await v283EnsureSession(first?.title ?? '未命名')
      for (const c of chapters) {
        await v283PushChapter(sid, c.title, c.content)
      }
      setMsg(`已创建会话并推入 ${chapters.length} 章`)
    } catch (e) {
      setMsg(`失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }
  const doContinue = async () => {
    if (!sessionId || sessionId === 'new') {
      setMsg('请先进入一个会话（取其模型设置）')
      return
    }
    setBusy(true)
    setMsg(extra.trim() ? '正在按续写要求续写…' : '正在续写…')
    try {
      const { getSessionSettings } = await import('@/stores/session/session-settings')
      const settings = await getSessionSettings(sessionId)
      const last = chapters.at(-1)
      const context = chapters.map((c) => `【${c.title}】${c.content}`).join('\n').slice(-8000)
      const out = await v27Continue(settings, context, extra.trim())
      setChapters([...chapters, { title: `第${cn(chapters.length + 1)}章（续）`, content: out }])
      setExtra('')
      setMsg('续写完成（已追加一章，可继续续写或推入小说会话）')
    } catch (e) {
      setMsg(`失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap="md">
      {/* 原作续改：整本小说改写工作台 */}
      <Alert variant="light" color="grape" title="原作续改（整本小说改写）">
        导入小说资料 JSON（章节/人物/事件/世界书）→ 从某一章开始改写 → 逐章推进。导入纯本地解析，原著库只读，与聊天域完全隔离。
      </Alert>
      <input ref={novelFileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => void doNovelImport(e.target.files?.[0] ?? null)} />
      <Group justify="space-between">
        <Text size="sm" fw={600}>已导入书籍（{novels.length}）</Text>
        <Button size="xs" variant="default" loading={importing} leftSection={<IconBookUpload size={14} />} onClick={() => novelFileRef.current?.click()}>
          导入小说资料
        </Button>
      </Group>
      {importMsg ? <Text size="xs" c="dimmed">{importMsg}</Text> : null}
      {novels.length === 0 ? (
        <Card withBorder padding="sm">
          <Text size="sm" c="dimmed">还没有导入书籍。点「导入小说资料」选择 JSON 文件（格式见《小说导入资料与格式规范》：chapters / characterBaselines / evolutionEvents / worldbook）。</Text>
        </Card>
      ) : (
        <Stack gap="xs">
          {novels.map((b) => {
            const done = b.rewriteNodes.filter((n) => n.status === 'finalized').length
            const draft = b.rewriteNodes.length - done
            return (
              <Card key={b.bookId} withBorder padding="sm">
                <Group justify="space-between" wrap="wrap">
                  <Stack gap={2} style={{ flex: 1, minWidth: 180 }}>
                    <Text size="sm" fw={600}>《{b.bookName}》</Text>
                    <Text size="xs" c="dimmed">
                      {b.chapters.length} 章（第 {b.chapters[0]?.chIndex}~{b.chapters.at(-1)?.chIndex} 章）· {b.baselines.length} 人物 · {b.events.length} 事件 · {b.worldbook.length} 设定
                      {b.rewriteNodes.length > 0 ? ` · 改写线 ${done} 定稿${draft ? ` + ${draft} 草稿` : ''}` : ''}
                    </Text>
                  </Stack>
                  <Group gap={6}>
                    <Button size="compact-xs" color="grape" leftSection={<IconWand size={12} />} onClick={() => setWorkbenchBookId(b.bookId)}>
                      进入改写
                    </Button>
                    <ActionIcon size="sm" color="red" variant="subtle" onClick={() => void removeBook(b.bookId, b.bookName)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Card>
            )
          })}
        </Stack>
      )}
      <Divider label="小说续写（V10 旧功能：粘贴切章→续写→推入会话）" labelPosition="left" />
      <Textarea label="正文（支持 第X章/Chapter N/楔子/番外 等标题切分）" autosize minRows={8} value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <Group grow>
        <Button size="xs" variant="default" onClick={doSplit}>切章</Button>
        <Button size="xs" color="teal" onClick={() => void doContinue()} loading={busy} disabled={chapters.length === 0}>续写一章</Button>
        <Button size="xs" color="brand" onClick={() => void pushToSession()} loading={busy} disabled={chapters.length === 0}>推入小说会话</Button>
      </Group>
      <TextInput
        size="xs"
        label="续写要求（可选）"
        placeholder="如：这一章写到主角抵达长安城，并引出镇魔司内鬼线索"
        value={extra}
        onChange={(e) => setExtra(e.currentTarget.value)}
        disabled={chapters.length === 0}
      />
      {msg ? <Text size="sm">{msg}</Text> : null}
      <Divider label="高级：改写末章（生成方案）" labelPosition="left" />
      <Group>
        <Button size="xs" variant="default" onClick={() => void genPlans()} loading={busy} disabled={chapters.length === 0}>生成改写方案</Button>
        <Text size="xs" c="dimmed">为末章生成 3 个后续走向方案，点方案即可按它重写末章。</Text>
      </Group>
      {plans.map((p) => (
        <Card key={p.index} withBorder padding="sm">
          <Group justify="space-between">
            <Stack gap={2} style={{ flex: 1 }}>
              <Text size="sm" fw={600}>{p.title}</Text>
              <Text size="xs" c="dimmed">{p.description}</Text>
            </Stack>
            <Button size="compact-xs" variant="light" onClick={() => void rewritePlan(p)}>按此方案改写末章</Button>
          </Group>
        </Card>
      ))}
      <Divider label={`章节预览（${chapters.length} 章）`} />
      <Stack gap="xs">
        {chapters.map((c, i) => (
          <Card key={i} withBorder padding="sm">
            <Text size="sm" fw={600}>{c.title}</Text>
            <Text size="xs" c="dimmed" lineClamp={3}>{c.content}</Text>
          </Card>
        ))}
        {chapters.length === 0 ? <Text c="dimmed" size="sm">切章后在此预览。</Text> : null}
      </Stack>

      {/* 原作续改：独立全屏改写工作台 */}
      {workbenchBookId ? <NovelRewriteWorkbench bookId={workbenchBookId} onExit={() => setWorkbenchBookId(null)} /> : null}
    </Stack>
  )
}

/* ======================== 原作续改 · 独立改写工作台（全屏） ======================== */

function NovelRewriteWorkbench({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const sessionId = useAtomValue(currentSessionIdAtom)
  const novels = useAtomValue(novelBooksAtom)
  const book = novels.find((x) => x.bookId === bookId)
  // 当前浏览的原章节号（默认起点章）
  const [viewCh, setViewCh] = useState<number>(book?.startChIndex ?? book?.chapters[0]?.chIndex ?? 1)
  // 页签：原文 / 改写版 / 预告
  const [tab, setTab] = useState<'original' | 'revised' | 'preview'>('original')
  // 选中改写节点 id（某章有多个节点时选一个；默认最后一个）
  const [nodeId, setNodeId] = useState<string | null>(null)
  // 改写指令（无节点/重写时用）
  const [instruction, setInstruction] = useState('')
  // 草稿编辑文本（AI 生成后可手动改）
  const [draftText, setDraftText] = useState('')
  // 锚点编辑
  const [anchorText, setAnchorText] = useState('')
  // 重写模式（定稿后想重写本章）
  const [rewriteMode, setRewriteMode] = useState(false)
  // 改预告编辑（{index, ch, title, brief} 非空时展开编辑行）
  const [previewEdit, setPreviewEdit] = useState<{ i: number; ch: string; title: string; brief: string } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('')
  // 章节列表弹层（搜索 + 状态筛选 + 设为起点）
  const [listOpen, setListOpen] = useState(false)
  const [listQuery, setListQuery] = useState('')
  const [listFilter, setListFilter] = useState<'all' | 'todo' | 'done'>('all')
  // 取消生成（AbortController 贯穿改写/定稿请求）
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!book) return
    const nodes = book.rewriteNodes.filter((n) => n.chapter === viewCh)
    if (nodes.length > 0) setNodeId(nodes.at(-1)?.id ?? null)
    else setNodeId(null)
    setDraftText(nodes.at(-1)?.revised ?? '')
    setAnchorText(nodes.at(-1)?.anchor ?? '')
    setRewriteMode(false)
    setInstruction('')
  }, [book, viewCh])

  if (!book) {
    return (
      <Modal fullScreen opened onClose={onExit} padding={0}>
        <Stack align="center" gap="md" style={{ padding: 40 }}>
          <Text c="dimmed">书籍不存在（可能已被删除）</Text>
          <Button onClick={onExit} variant="default" size="xs">返回</Button>
        </Stack>
      </Modal>
    )
  }

  const chapter = book.chapters.find((c) => c.chIndex === viewCh)
  const node = book.rewriteNodes.find((n) => n.id === nodeId) ?? null
  const prevNode = book.rewriteNodes.filter((n) => n.chapter < viewCh && n.status === 'finalized').at(-1) ?? null
  const nextCh = book.chapters.find((c) => c.chIndex > viewCh) ?? null
  const recentFinalized = book.rewriteNodes.filter((n) => n.status === 'finalized').sort((a, b) => a.chapter - b.chapter).slice(-3)

  /** 组装注入（前情=最近定稿锚点或起点前概要；事件≤当前章；预告=原预告+最近改预告） */
  const buildInj = () => {
    const N = viewCh
    const prior =
      prevNode?.anchor ||
      book.chapters
        .filter((c) => c.chIndex < N)
        .map((c) => `第${c.chIndex}章 ${c.title}：${c.summary}`)
        .join('\n')
        .slice(0, 3000)
    return {
      prior,
      original: chapter?.original ?? '',
      baselines: book.baselines.map((b) => ({ name: b.name, backgroundStory: b.backgroundStory, keywords: b.keywords })),
      events: book.events.filter((e) => e.chapter <= N).map((e) => ({ roleName: e.roleName, content: e.content, chapter: e.chapter })),
      originalPreview: chapter?.originalPreview ?? [],
      revisedPreview: prevNode?.revisedPreview ?? [],
    }
  }

  /** AI 改写本章（生成草稿节点） */
  const doRewrite = async () => {
    if (!sessionId || sessionId === 'new') {
      setAiMsg('请先进入一个会话（取其模型设置，可从小说列表进入会话）')
      return
    }
    if (!instruction.trim() && !node) {
      setAiMsg('请先输入改写指令（要改什么：扩写某段/改变走向/新增情节…）')
      return
    }
    setAiBusy(true)
    setAiMsg('')
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const { getSessionSettings } = await import('@/stores/session/session-settings')
      const settings = await getSessionSettings(sessionId)
      const { v283NovelRewrite } = await import('../novel')
      const inj = buildInj()
      const r = await v283NovelRewrite(settings, inj, node ? draftText : instruction.trim(), ac.signal)
      const now = Date.now()
      const newId = node?.id ?? `${bookId}-n${viewCh}-${now}`
      await upsertRewriteNode(bookId, {
        id: newId,
        bookId,
        refChapterId: chapter?.id ?? '',
        chapter: viewCh,
        title: node?.title ?? `改${viewCh}章 · ${chapter?.title ?? ''}`,
        revised: r.revised,
        anchor: r.anchor || anchorText,
        revisedPreview: node?.revisedPreview ?? [],
        status: 'draft',
        createdAt: node?.createdAt ?? now,
        updatedAt: now,
      })
      setDraftText(r.revised)
      setAnchorText(r.anchor)
      setInstruction('')
      setTab('revised')
      setAiMsg(node ? '已重新生成改写稿（草稿，可编辑后定稿）' : '改写完成（草稿，可编辑后定稿）')
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      setAiMsg(e instanceof DOMException && e.name === 'AbortError' || /abort|cancel/i.test(msg) ? '已取消（未保存任何内容）' : `失败：${msg}`)
    } finally {
      abortRef.current = null
      setAiBusy(false)
    }
  }

  /** 定稿：保存草稿 + 生成改预告（读最近≤3章） */
  const doFinalize = async () => {
    if (!node || !sessionId || sessionId === 'new') return
    setAiBusy(true)
    setAiMsg('正在定稿并生成改剧情预告…')
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const { getSessionSettings } = await import('@/stores/session/session-settings')
      const settings = await getSessionSettings(sessionId)
      const { v283GenRevisedPreview } = await import('../novel')
      // 1) 保存草稿（含手动编辑与锚点）
      const finalizedNode: RewriteNode = { ...node, revised: draftText, anchor: anchorText, status: 'finalized', updatedAt: Date.now() }
      // 2) 生成改预告：最近定稿（含本章）+ 原预告参照；预告章数默认 3（可后续编辑）
      const recent = [...recentFinalized.filter((n) => n.chapter !== viewCh), finalizedNode].slice(-3)
      const previews = await v283GenRevisedPreview(
        settings,
        recent.map((n) => ({ chapter: n.chapter, title: n.title, revised: n.revised, anchor: n.anchor })),
        chapter?.originalPreview ?? [],
        3,
        ac.signal
      )
      finalizedNode.revisedPreview = previews.length ? previews : node.revisedPreview
      await upsertRewriteNode(bookId, finalizedNode)
      setAiMsg(previews.length ? `定稿完成，改预告已生成（${previews.length} 章，可在「双预告」页签编辑）` : '定稿完成（改预告未生成，可稍后手动编辑）')
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      setAiMsg(e instanceof DOMException && e.name === 'AbortError' || /abort|cancel/i.test(msg) ? '已取消（本章保持原状，未定稿）' : `失败：${msg}`)
    } finally {
      abortRef.current = null
      setAiBusy(false)
    }
  }

  /** 推进到下一章 */
  const doAdvance = () => {
    if (!nextCh) return
    setViewCh(nextCh.chIndex)
    setInstruction('')
    setTab('revised')
    setAiMsg('')
  }

  // 章节列表：搜索 + 状态筛选（纯前端过滤）
  const listQ = listQuery.trim().toLowerCase()
  const listChapters = book.chapters.filter((c) => {
    const hit = !listQ || String(c.chIndex).includes(listQ) || (c.title ?? '').toLowerCase().includes(listQ) || (c.summary ?? '').toLowerCase().includes(listQ)
    if (!hit) return false
    const nodes = book.rewriteNodes.filter((n) => n.chapter === c.chIndex)
    if (listFilter === 'todo') return nodes.length === 0
    if (listFilter === 'done') return nodes.some((n) => n.status === 'finalized')
    return true
  })

  return (
    <Modal fullScreen opened onClose={onExit} padding={0} styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%' }, inner: { padding: 0 }, content: { height: '100%' } }}>
      {/* 顶栏：退出 / 书名·当前章 */}
      <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid #eee', background: '#fafbfc', flexShrink: 0 }}>
        <ActionIcon onClick={onExit} variant="subtle" size="lg" title="退出（进度已保存）"><IconArrowBack size={18} /></ActionIcon>
        <Stack gap={0} align="center" style={{ flex: 1 }}>
          <Text size="sm" fw={700}>《{book.bookName}》</Text>
          <Text size="xs" c="dimmed">{chapter ? `${chapter.chIndex}章 · ${chapter.title}` : '章节不存在'}</Text>
        </Stack>
        <ActionIcon variant="subtle" size="lg" title="操作" onClick={() => window.confirm('退出后进度自动保存，改写线不会丢失。')}>
          <IconDots size={18} />
        </ActionIcon>
      </Group>

      {/* 章节胶囊：就近 ±3 章（号+名两行） + 列表入口 */}
      <Box style={{ overflowX: 'auto', flexShrink: 0, borderBottom: '1px solid #f0f0f0', padding: '6px 10px' }}>
        <Group gap={6} wrap="nowrap" align="center">
          {book.chapters.filter((c) => Math.abs(c.chIndex - viewCh) <= 3).map((c) => {
            const nodes = book.rewriteNodes.filter((n) => n.chapter === c.chIndex)
            const finalized = nodes.some((n) => n.status === 'finalized')
            const active = c.chIndex === viewCh
            return (
              <UnstyledButton
                key={c.chIndex}
                onClick={() => { setViewCh(c.chIndex); setTab('original') }}
                style={{
                  borderRadius: 10, padding: '3px 10px', whiteSpace: 'nowrap', flexShrink: 0,
                  background: active ? (finalized ? '#16a34a' : '#7c3aed') : '#f3f4f6',
                  border: finalized && !active ? '1px solid #bbf7d0' : '1px solid transparent',
                }}
              >
                <Stack gap={0} align="center">
                  <Text size="11" fw={700} c={active ? '#fff' : (finalized ? '#16a34a' : '#4b5563')}>{finalized ? '✓ ' : ''}{c.chIndex}{active ? ' ▶' : ''}</Text>
                  <Text size="9" c={active ? '#fef9c3' : '#9ca3af'} style={{ maxWidth: 76, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                    {c.title || '（无题）'}
                  </Text>
                </Stack>
              </UnstyledButton>
            )
          })}
          <ActionIcon variant="subtle" size="md" title="章节列表（搜索/筛选/设为起点）" onClick={() => setListOpen(true)}>
            <IconMenu2 size={18} />
          </ActionIcon>
        </Group>
      </Box>

      {/* 主体：原文 / 改写版 / 预告 页签 */}
      <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(v) => setTab((v ?? 'original') as 'original' | 'revised' | 'preview')} keepMounted={false} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Tabs.List grow>
            <Tabs.Tab value="original">原文</Tabs.Tab>
            <Tabs.Tab value="revised">改写版{node ? (node.status === 'finalized' ? ' ✓' : ' (草稿)') : ''}</Tabs.Tab>
            <Tabs.Tab value="preview">双预告</Tabs.Tab>
          </Tabs.List>
          <Box style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            <Tabs.Panel value="original">
              {chapter ? (
                <Stack gap="sm">
                  <Text size="sm" fw={600}>{chapter.chIndex}章 · {chapter.title}</Text>
                  {chapter.summary ? (
                    <Box style={{ background: '#f3f4f6', borderLeft: '3px solid #cbd5e1', borderRadius: 6, padding: '6px 10px' }}>
                      <Text size="xs" c="dimmed" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{chapter.summary}</Text>
                    </Box>
                  ) : null}
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, color: '#374151' }}>
                    {chapter.original || <span style={{ color: '#e11d48' }}>（本章原文为空——导入资料缺正文）</span>}
                  </Text>
                </Stack>
              ) : <Text c="dimmed" size="sm">章节不存在</Text>}
            </Tabs.Panel>
            <Tabs.Panel value="revised">
              {node && !rewriteMode ? (
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Badge color={node.status === 'finalized' ? 'green' : 'orange'}>{node.status === 'finalized' ? '已定稿' : '草稿'}</Badge>
                    <Text size="xs" c="dimmed">{node.title}</Text>
                  </Group>
                  {node.status === 'finalized' ? (
                    <>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, color: '#374151' }}>{node.revised || '（暂无内容）'}</Text>
                      <Divider />
                      <Group justify="space-between">
                        <Text size="xs" c="dimmed">锚点：{node.anchor || '未设置'}</Text>
                        <Button size="compact-xs" variant="default" onClick={() => setRewriteMode(true)}>重写本章</Button>
                      </Group>
                    </>
                  ) : (
                    <>
                      <Textarea
                        label="改写稿（可手动编辑）"
                        autosize
                        minRows={8}
                        value={draftText}
                        onChange={(e) => setDraftText(e.currentTarget.value)}
                      />
                      <TextInput
                        size="xs"
                        label="剧情锚点（本章结束时剧情状态，供下一章前情注入）"
                        placeholder="如：罗素救出白婷婷，但帝释天在暗处盯上了他"
                        value={anchorText}
                        onChange={(e) => setAnchorText(e.currentTarget.value)}
                      />
                    </>
                  )}
                </Stack>
              ) : (
                <Stack gap="sm" style={{ paddingTop: 12 }}>
                  <Textarea
                    label={node ? '改写指令（覆盖本章，重新生成）' : '改写指令'}
                    autosize
                    minRows={4}
                    placeholder="要改什么？如：本章扩写罗素潜入净身房的复仇戏，增加与帝释天的正面冲突；或：删掉本章的偶遇情节，改为直接遭遇追杀。"
                    value={instruction}
                    onChange={(e) => setInstruction(e.currentTarget.value)}
                  />
                  {node ? (
                    <Group justify="space-between">
                      <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setRewriteMode(false)}>取消重写</Button>
                      <Text size="xs" c="dimmed">点底部「AI 改写本章」覆盖当前稿</Text>
                    </Group>
                  ) : (
                    <Text size="xs" c="dimmed">AI 将基于：前情概要（最近定稿锚点）+ 本章原文 + 人物基线 + 已发生事件（≤本章）+ 双预告 生成改写稿。可在底部点「AI 改写本章」。</Text>
                  )}
                </Stack>
              )}
            </Tabs.Panel>
            <Tabs.Panel value="preview">
              <Stack gap="md">
                <Box>
                  <Text size="xs" fw={700} c="blue" mb={4}>原剧情预告（参照系 · 点条目看对应章节）</Text>
                  <Stack gap={4}>
                    {(chapter?.originalPreview ?? []).map((p) => (
                      <Card key={p.ch} withBorder padding="xs" style={{ cursor: 'pointer' }} onClick={() => { const c = book.chapters.find((x) => x.chIndex === p.ch); if (c) { setViewCh(c.chIndex); setTab('original') } }}>
                        <Text size="sm">原{p.ch}章 · {p.title}</Text>
                        <Text size="xs" c="dimmed">{p.brief}</Text>
                      </Card>
                    ))}
                    {!chapter?.originalPreview?.length ? <Text size="xs" c="dimmed">本章没有原预告（资料未提供或已到全书末尾）</Text> : null}
                  </Stack>
                </Box>
                <Divider />
                <Box>
                  <Text size="xs" fw={700} c="grape" mb={4}>改剧情预告（执行约束 · AI 推导可编辑）</Text>
                  <Stack gap={4}>
                    {(node?.revisedPreview ?? []).map((p, i) =>
                      previewEdit?.i === i ? (
                        <Card key={i} withBorder padding="xs">
                          <Stack gap={4}>
                            <Group gap={6}>
                              <TextInput size="xs" style={{ width: 90 }} value={previewEdit.ch} onChange={(e) => setPreviewEdit({ ...previewEdit, ch: e.currentTarget.value })} />
                              <TextInput size="xs" style={{ flex: 1 }} value={previewEdit.title} onChange={(e) => setPreviewEdit({ ...previewEdit, title: e.currentTarget.value })} />
                            </Group>
                            <Textarea size="xs" autosize minRows={2} value={previewEdit.brief} onChange={(e) => setPreviewEdit({ ...previewEdit, brief: e.currentTarget.value })} />
                            <Group justify="flex-end" gap={6}>
                              <Button
                                size="compact-xs"
                                variant="light"
                                color="teal"
                                onClick={async () => {
                                  if (!node) return
                                  const list = [...node.revisedPreview]
                                  list[i] = { ch: previewEdit.ch, title: previewEdit.title, brief: previewEdit.brief }
                                  await upsertRewriteNode(bookId, { ...node, revisedPreview: list, updatedAt: Date.now() })
                                  setPreviewEdit(null)
                                  setAiMsg('改预告已更新')
                                }}
                              >
                                保存
                              </Button>
                              <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setPreviewEdit(null)}>取消</Button>
                            </Group>
                          </Stack>
                        </Card>
                      ) : (
                        <Card key={i} withBorder padding="xs">
                          <Group justify="space-between">
                            <Stack gap={2} style={{ flex: 1 }}>
                              <Text size="sm">{p.ch} · {p.title}</Text>
                              <Text size="xs" c="dimmed">{p.brief}</Text>
                            </Stack>
                            <ActionIcon size="sm" variant="subtle" onClick={() => setPreviewEdit({ i, ch: p.ch, title: p.title, brief: p.brief })}>
                              <IconPencil size={14} />
                            </ActionIcon>
                          </Group>
                        </Card>
                      )
                    )}
                    {!node?.revisedPreview?.length ? <Text size="xs" c="dimmed">定稿本章后由 AI 生成改预告（最多读最近 3 章），可手动编辑。</Text> : null}
                  </Stack>
                </Box>
              </Stack>
            </Tabs.Panel>
          </Box>
        </Tabs>
      </Box>

      {/* 底部操作条 */}
      <Box px="md" py="sm" style={{ borderTop: '1px solid #eee', background: '#fafbfc', flexShrink: 0 }}>
        <Stack gap={6}>
          <Group justify="space-between">
            {node && !rewriteMode ? (
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>锚点：{node.anchor || '未设置'}</Text>
            ) : prevNode ? (
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>上一锚点：{prevNode.anchor || '未设置'}</Text>
            ) : (
              <UnstyledButton onClick={() => setListOpen(true)} style={{ flex: 1, textAlign: 'left', color: '#7c3aed', fontWeight: 600, fontSize: 13 }}>
                从起点章开始 ▾（点击选择起点章）
              </UnstyledButton>
            )}
            <Group gap={8}>
              {(!node || rewriteMode) ? (
                aiBusy ? (
                  <Button size="xs" color="red" onClick={() => abortRef.current?.abort()}>取消生成</Button>
                ) : (
                  <Button size="xs" color="grape" disabled={!instruction.trim()} onClick={() => void doRewrite()}>
                    AI 改写本章
                  </Button>
                )
              ) : node.status === 'draft' ? (
                aiBusy ? (
                  <Button size="xs" color="red" onClick={() => abortRef.current?.abort()}>取消</Button>
                ) : (
                  <Button size="xs" color="teal" disabled={!draftText.trim()} onClick={() => void doFinalize()}>
                    定稿（生成改预告）
                  </Button>
                )
              ) : (
                aiBusy ? (
                  <Button size="xs" color="red" onClick={() => abortRef.current?.abort()}>取消</Button>
                ) : (
                  <Button size="xs" color="teal" variant="default" onClick={() => void doFinalize()}>
                    重新定稿
                  </Button>
                )
              )}
              {node && node.status === 'finalized' && !rewriteMode ? (
                <Button size="xs" color="grape" disabled={!nextCh} onClick={doAdvance}>
                  {nextCh ? `推进 · 改写第${nextCh.chIndex}章` : '已是最后一章'}
                </Button>
              ) : null}
            </Group>
          </Group>
          {aiMsg ? <Text size="xs" c="dimmed">{aiMsg}</Text> : null}
        </Stack>
      </Box>

      {/* 章节列表弹层：搜索 / 筛选 / 设为起点 */}
      <Modal fullScreen opened={listOpen} onClose={() => setListOpen(false)} padding={0} styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%' }, inner: { padding: 0 }, content: { height: '100%' } }}>
        <Stack gap={0} style={{ height: '100%' }}>
          <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid #eee', background: '#fafbfc', flexShrink: 0 }}>
            <ActionIcon onClick={() => setListOpen(false)} variant="subtle" size="lg"><IconArrowBack size={18} /></ActionIcon>
            <Text size="sm" fw={700}>章节列表 · 《{book.bookName}》</Text>
            <Text size="xs" c="dimmed">{book.chapters.length} 章</Text>
          </Group>
          <Box px="md" py="sm" style={{ borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
            <Stack gap={6}>
              <TextInput size="xs" placeholder="搜索章节号 / 标题 / 概述关键词" value={listQuery} onChange={(e) => setListQuery(e.currentTarget.value)} leftSection={<IconSearch size={14} />} />
              <SegmentedControl size="xs" fullWidth value={listFilter} onChange={(v) => setListFilter(v as 'all' | 'todo' | 'done')} data={[{ label: '全部', value: 'all' }, { label: '待改写', value: 'todo' }, { label: '已定稿', value: 'done' }]} />
            </Stack>
          </Box>
          <Box style={{ flex: 1, overflow: 'auto', padding: '4px 10px' }}>
            <Stack gap={4}>
              {listChapters.map((c) => {
                const nodes = book.rewriteNodes.filter((n) => n.chapter === c.chIndex)
                const done = nodes.some((n) => n.status === 'finalized')
                const draft = nodes.some((n) => n.status === 'draft')
                const active = c.chIndex === viewCh
                return (
                  <UnstyledButton
                    key={c.chIndex}
                    onClick={() => { setViewCh(c.chIndex); setTab('original'); setListOpen(false) }}
                    style={{ display: 'block', width: '100%', borderRadius: 10, border: active ? '1.5px solid #7c3aed' : '1px solid #e5e7eb', background: active ? '#f5f3ff' : '#fff', padding: '8px 10px', textAlign: 'left' }}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                        <Text size="sm" fw={700} c={done ? '#16a34a' : active ? '#7c3aed' : undefined}>{done ? '✓ ' : ''}{c.chIndex}</Text>
                        <Text size="sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || '（无题）'}</Text>
                      </Group>
                      <Group gap={4} wrap="nowrap">
                        {draft && !done ? <Badge size="xs" color="orange" variant="light">草稿</Badge> : null}
                        {done ? <Badge size="xs" color="green" variant="light">已定稿</Badge> : null}
                        {active ? <Badge size="xs" color="violet" variant="filled">起点</Badge> : null}
                      </Group>
                    </Group>
                    {c.summary ? (
                      <Text size="xs" c="dimmed" style={{ marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.5 }}>{c.summary}</Text>
                    ) : null}
                  </UnstyledButton>
                )
              })}
              {listChapters.length === 0 ? <Text size="xs" c="dimmed" ta="center" style={{ padding: 24 }}>没有匹配的章节（可换关键词或筛选）</Text> : null}
            </Stack>
          </Box>
          <Box px="md" py="xs" style={{ borderTop: '1px solid #eee', flexShrink: 0 }}>
            <Text size="xs" c="dimmed" ta="center">点章节 = 设为起点并跳转；起点可随时更换，原草稿/定稿不丢</Text>
          </Box>
        </Stack>
      </Modal>
    </Modal>
  )
}

function cn(n: number): string {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  return n < 10 ? d[n] : n < 100 ? (n < 20 ? '' : d[Math.floor(n / 10)]) + '十' + (n % 10 ? d[n % 10] : '') : String(n)
}

/* ======================== 设置/导出 ======================== */

function SettingsTab() {
  const settings = useAtomValue(modSettingsAtom)
  const backups = useAtomValue(modBackupsAtom)
  const [restoreResult, setRestoreResult] = useState('')
  const [importing, setImporting] = useState(false)
  const [hasV48, setHasV48] = useState(false)
  const [exportCfg, setExportCfg] = useState<ExportModalConfig | null>(null)
  const [exportOpen, { open: openExport, close: closeExport }] = useDisclosure(false)
  // 硅基流动余额查询
  const [sfKey, setSfKey] = useState(settings.siliconflowApiKey ?? '')
  const [sfBusy, setSfBusy] = useState(false)
  const [sfResult, setSfResult] = useState('')
  const [sfOk, setSfOk] = useState(false)

  const querySfBalance = async () => {
    const key = sfKey.trim()
    if (!key) {
      setSfResult('请先填入 API Key')
      setSfOk(false)
      return
    }
    setSfBusy(true)
    setSfResult('查询中…')
    try {
      await updateModSettings({ siliconflowApiKey: key })
      const r = await fetch('https://api.siliconflow.cn/v1/user/info', {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (r.status === 410) {
        throw new Error('SiliconFlow 官方已下线 /user/info 余额接口（2026-08-14 起），替代接口尚未发布，暂无法在应用内查询余额；可登录 cloud.siliconflow.cn 控制台查看')
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? '（Key 无效或已过期）' : ''}`)
      const j = (await r.json()) as {
        data?: { totalBalance?: number | string; cashBalance?: number | string; accruedBalance?: number | string }
      }
      const d = j.data ?? {}
      const yuan = (v: unknown) => {
        const n = Number(v)
        return Number.isFinite(n) ? n.toFixed(2) : '--'
      }
      setSfResult(`总余额：¥${yuan(d.totalBalance)} ｜ 可用余额：¥${yuan(d.cashBalance)}`)
      setSfOk(true)
    } catch (e) {
      setSfResult(`查询失败：${String((e as Error)?.message ?? e)}`)
      setSfOk(false)
    } finally {
      setSfBusy(false)
    }
  }

  useEffect(() => {
    void import('../migration').then(({ hasV48Data }) => setHasV48(hasV48Data()))
  }, [])

  const doMigrate = async () => {
    const { migrateV48Data } = await import('../migration')
    const r = await migrateV48Data()
    setRestoreResult(
      r.alreadyMigrated
        ? '已迁移过（跳过）'
        : r.done
          ? `迁移完成：世界书+${r.worldBooksAdded} 人物卡+${r.characterCardsAdded} 文件夹+${r.foldersAdded} 备份+${r.backupsAdded}`
          : `迁移失败：${r.error}`
    )
    setHasV48(false)
  }

  const doExport = () => {
    setExportCfg({
      defaultName: 'chatbox-mod-data.json',
      makeBlob: () => new Blob([JSON.stringify(buildExportPayload(), null, 2)], { type: 'application/json' }),
    })
    openExport()
  }
  const doImport = async (file: File | null) => {
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const r = await importModData(text)
      setRestoreResult(r.ok ? `导入成功${r.added ? `（${r.added} 条）` : ''}` : `导入失败：${r.error}`)
    } catch (e) {
      setRestoreResult(`导入异常：${String((e as Error)?.message ?? e)}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Stack gap="md">
      <Group grow>
        <NumberInput label="世界书注入上限（字符）" value={settings.wbInjectionLimit} min={500} max={20000} onChange={(v) => void updateModSettings({ wbInjectionLimit: Number(v) || 4000 })} />
        <NumberInput label="人物卡注入上限（字符）" value={settings.ccInjectionLimit} min={500} max={20000} onChange={(v) => void updateModSettings({ ccInjectionLimit: Number(v) || 6000 })} />
        <NumberInput label="备份保留份数" value={settings.backupLimit} min={1} max={20} onChange={(v) => void updateModSettings({ backupLimit: Number(v) || 5 })} />
      </Group>
      <Divider label="导出 / 导入" />
      <Group>
        <Button leftSection={<IconBookDownload size={16} />} onClick={() => void doExport()}>导出全部数据 (JSON)</Button>
        <Tooltip label="选择 chatbox-mod 导出文件">
          <label>
            <Button component="span" variant="default" leftSection={<IconBookUpload size={16} />} loading={importing}>导入数据</Button>
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => void doImport(e.target.files?.[0] ?? null)} />
          </label>
        </Tooltip>
        <Button variant="default" leftSection={<IconHistory size={16} />} onClick={() => void clearModLog()}>清空日志</Button>
        {hasV48 && (
          <Button color="teal" variant="light" onClick={() => void doMigrate()}>迁移 v48 旧数据</Button>
        )}
      </Group>
      <Divider label={`自动更新备份（${backups.length} 份，恢复会写回变更并撤销新增）`} />
      <Stack gap="xs">
        {backups.map((b, i) => (
          <Group key={i} justify="space-between">
            <Text size="xs" c="dimmed">{new Date(b.t).toLocaleString()}（wb {b.wbBack.length} / cc {b.ccBack.length}）</Text>
            <Button size="compact-xs" color="red" variant="subtle" onClick={async () => {
              const r = await restoreModBackup(i)
              setRestoreResult(r.ok ? `已恢复（${r.done} 条）` : `恢复失败：${r.error}`)
            }}>恢复此备份</Button>
          </Group>
        ))}
        {backups.length === 0 ? <Text c="dimmed" size="sm">暂无备份。</Text> : null}
      </Stack>
      {restoreResult ? <Text size="sm">{restoreResult}</Text> : null}
      <ExportModal
        opened={exportOpen}
        onClose={closeExport}
        title="导出全部数据"
        defaultName={exportCfg?.defaultName}
        makeBlob={exportCfg?.makeBlob}
        description="导出世界书 / 人物卡 / 设置 / 日志 / 备份的完整 JSON。可修改导出文件名；点击导出后按系统提示选择保存到指定位置。"
        onDone={(_ok, m) => setRestoreResult(m)}
      />
      <Divider label="硅基流动（SiliconFlow）" labelPosition="left" />
      <Group align="flex-end" gap="xs">
        <TextInput
          style={{ flex: 1 }}
          size="xs"
          type="password"
          label="API Key"
          placeholder="sk-xxx 粘贴你的 SiliconFlow Key"
          value={sfKey}
          onChange={(e) => setSfKey(e.currentTarget.value)}
        />
        <Button size="xs" onClick={() => void querySfBalance()} loading={sfBusy}>查询余额</Button>
      </Group>
      {sfResult ? <Text size="xs" c={sfOk ? 'green' : 'red'}>{sfResult}</Text> : null}
      <Divider label="关于" labelPosition="left" />
      <Text size="xs" c="dimmed">
        Chatbox Mod fork · 版本：{MOD_BUILD}
      </Text>
    </Stack>
  )
}
