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
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconBook2, IconBookDownload, IconBookUpload, IconHistory, IconRefresh, IconRobot, IconSettings, IconUsers, IconWand } from '@tabler/icons-react'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
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
  removeCharacterCard,
  removeWorldBook,
  restoreCharacterCardVersion,
  restoreModBackup,
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
import { exportModData, importModData } from '../export'
import { splitChapters, v27Continue, v283EnsureSession, v283GenOptions, v283PushChapter, v283Rewrite } from '../novel'
import type { RewritePlan } from '../novel'

export function ChatboxModPage() {
  return (
    <Page title="Chatbox Mod">
      <Tabs defaultValue="worldbook" keepMounted={false} style={{ flex: 1, minHeight: 0 }}>
        <Tabs.List>
          <Tabs.Tab value="worldbook" leftSection={<IconBook2 size={16} />}>世界书</Tabs.Tab>
          <Tabs.Tab value="characters" leftSection={<IconUsers size={16} />}>人物卡</Tabs.Tab>
          <Tabs.Tab value="binding" leftSection={<IconRobot size={16} />}>会话装载</Tabs.Tab>
          <Tabs.Tab value="auto" leftSection={<IconRefresh size={16} />}>自动更新</Tabs.Tab>
          <Tabs.Tab value="novel" leftSection={<IconWand size={16} />}>小说分章</Tabs.Tab>
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

/* ======================== 世界书 ======================== */

function WorldBooksTab() {
  const items = useAtomValue(worldBooksAtom)
  const folders = useAtomValue(foldersAtom)
  const [editing, setEditing] = useState<WorldBookEntry | null>(null)
  const [opened, { open, close }] = useDisclosure(false)
  const wbFolders = folders.filter((f) => f.kind === 'wb')

  const openNew = () => {
    setEditing({ id: uuidv4(), name: '', content: '', keywords: [], enabled: true, triggerMode: 'keyword' })
    open()
  }
  const openEdit = (w: WorldBookEntry) => {
    setEditing({ ...w, keywords: [...w.keywords] })
    open()
  }
  const save = async () => {
    if (!editing) return
    await addOrUpdateWorldBook(editing)
    close()
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text c="dimmed" size="sm">共 {items.length} 条世界书</Text>
        <Group>
          <FolderManager kind="wb" />
          <Button size="xs" onClick={openNew}>+ 新建世界书</Button>
        </Group>
      </Group>
      <Stack gap="xs">
        {items.map((w) => (
          <Card key={w.id} withBorder padding="sm">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs">
                  <Text fw={600} size="sm" lineClamp={1}>{w.name}</Text>
                  <Badge size="xs" variant="light" color={w.triggerMode === 'always' ? 'green' : 'blue'}>
                    {w.triggerMode === 'always' ? '始终' : '关键词'}
                  </Badge>
                  {w.folderId ? <Badge size="xs" variant="outline">{wbFolders.find((f) => f.id === w.folderId)?.name ?? '未知文件夹'}</Badge> : null}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{w.content}</Text>
                {w.keywords.length > 0 ? <Text size="xs" c="gray">{w.keywords.join('、')}</Text> : null}
              </Stack>
              <Group gap={4} wrap="nowrap">
                <Switch checked={w.enabled !== false} size="xs" onChange={(e) => void toggleWorldBook(w.id, e.currentTarget.checked)} />
                <Button size="compact-xs" variant="subtle" onClick={() => openEdit(w)}>编辑</Button>
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => void removeWorldBook(w.id)}>删除</Button>
              </Group>
            </Group>
          </Card>
        ))}
        {items.length === 0 ? <Text c="dimmed" size="sm">还没有世界书，点击右上角新建。</Text> : null}
      </Stack>

      <Modal opened={opened} onClose={close} title="编辑世界书" size="lg">
        {editing && (
          <Stack gap="sm">
            <TextInput label="名称" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })} />
            <Textarea label="内容" autosize minRows={6} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.currentTarget.value })} />
            <TextInput
              label="触发关键词（逗号分隔）"
              value={editing.keywords.join('、')}
              onChange={(e) => setEditing({ ...editing, keywords: e.currentTarget.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) })}
            />
            <Group>
              <Select
                label="触发模式"
                data={[
                  { value: 'keyword', label: '关键词命中才注入' },
                  { value: 'always', label: '始终注入' },
                ]}
                value={editing.triggerMode ?? 'keyword'}
                onChange={(v) => setEditing({ ...editing, triggerMode: (v as 'keyword' | 'always') ?? 'keyword' })}
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
            </Group>
            <Group justify="flex-end">
              <Button variant="subtle" onClick={close}>取消</Button>
              <Button onClick={() => void save()}>保存</Button>
            </Group>
          </Stack>
        )}
      </Modal>
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
      <Button size="xs" variant="default" onClick={open}>文件夹</Button>
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

function CharactersTab() {
  const items = useAtomValue(characterCardsAtom)
  const [editing, setEditing] = useState<CharacterCard | null>(null)
  const [opened, { open, close }] = useDisclosure(false)
  const folders = useAtomValue(foldersAtom)
  const ccFolders = folders.filter((f) => f.kind === 'cc')

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

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text c="dimmed" size="sm">共 {items.length} 张人物卡</Text>
        <Group>
          <FolderManager kind="cc" />
          <Button size="xs" onClick={openNew}>+ 新建人物卡</Button>
        </Group>
      </Group>
      <Stack gap="xs">
        {items.map((c) => (
          <Card key={c.id} withBorder padding="sm">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs">
                  <Text fw={600} size="sm">{c.name}</Text>
                  {c.age ? <Text size="xs" c="dimmed">{c.age}岁</Text> : null}
                  {c.gender ? <Text size="xs" c="dimmed">{c.gender}</Text> : null}
                  {c.occupation ? <Badge size="xs" variant="outline">{c.occupation}</Badge> : null}
                  {c.folderId ? <Badge size="xs" variant="outline">{ccFolders.find((f) => f.id === c.folderId)?.name ?? '未知'}</Badge> : null}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{c.backgroundStory}</Text>
                {c.relationships.length > 0 ? (
                  <Text size="xs" c="gray">关系：{c.relationships.map((r) => `${r.targetName}(${r.relation})`).join('、')}</Text>
                ) : null}
              </Stack>
              <Group gap={4} wrap="nowrap">
                <Switch checked={c.enabled !== false} size="xs" onChange={(e) => void toggleCharacterCard(c.id, e.currentTarget.checked)} />
                <Button size="compact-xs" variant="subtle" onClick={() => openEdit(c)}>编辑</Button>
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => void removeCharacterCard(c.id)}>删除</Button>
              </Group>
            </Group>
          </Card>
        ))}
        {items.length === 0 ? <Text c="dimmed" size="sm">还没有人物卡。</Text> : null}
      </Stack>

      <Modal opened={opened} onClose={close} title="编辑人物卡" size="lg">
        {editing && <CharacterCardEditor card={editing} onChange={setEditing} folders={ccFolders} />}
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={close}>取消</Button>
          <Button onClick={() => void save()}>保存</Button>
        </Group>
      </Modal>
    </Stack>
  )
}

function CharacterCardEditor({ card, onChange, folders }: { card: CharacterCard; onChange: (c: CharacterCard) => void; folders: ModFolder[] }) {
  const set = (patch: Partial<CharacterCard>) => onChange({ ...card, ...patch })
  return (
    <Stack gap="sm">
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
      <Textarea label="外貌" autosize minRows={2} value={card.appearance} onChange={(e) => set({ appearance: e.currentTarget.value })} />
      <Textarea label="性格类型" autosize minRows={2} value={card.personalityType} onChange={(e) => set({ personalityType: e.currentTarget.value })} />
      <Group grow>
        <Textarea label="优点" autosize minRows={2} value={card.strengths} onChange={(e) => set({ strengths: e.currentTarget.value })} />
        <Textarea label="缺点" autosize minRows={2} value={card.weaknesses} onChange={(e) => set({ weaknesses: e.currentTarget.value })} />
      </Group>
      <Textarea label="爱好" autosize minRows={2} value={card.hobbies} onChange={(e) => set({ hobbies: e.currentTarget.value })} />
      <Textarea label="背景故事" autosize minRows={4} value={card.backgroundStory} onChange={(e) => set({ backgroundStory: e.currentTarget.value })} />
      <Divider label="关系" />
      {card.relationships.map((r, i) => (
        <Group key={i} grow>
          <TextInput placeholder="对象" value={r.targetName} onChange={(e) => set({ relationships: card.relationships.map((x, j) => (j === i ? { ...x, targetName: e.currentTarget.value } : x)) })} />
          <TextInput placeholder="关系" value={r.relation} onChange={(e) => set({ relationships: card.relationships.map((x, j) => (j === i ? { ...x, relation: e.currentTarget.value } : x)) })} />
          <ActionIcon color="red" variant="subtle" onClick={() => set({ relationships: card.relationships.filter((_, j) => j !== i) })}>✕</ActionIcon>
        </Group>
      ))}
      <Button size="compact-xs" variant="subtle" onClick={() => set({ relationships: [...card.relationships, { targetName: '', relation: '' }] })}>+ 添加关系</Button>
      <Divider label="自定义属性" />
      {card.customAttributes.map((a, i) => (
        <Group key={i} grow>
          <TextInput placeholder="属性名" value={a.key} onChange={(e) => set({ customAttributes: card.customAttributes.map((x, j) => (j === i ? { ...x, key: e.currentTarget.value } : x)) })} />
          <TextInput placeholder="属性值" value={a.value} onChange={(e) => set({ customAttributes: card.customAttributes.map((x, j) => (j === i ? { ...x, value: e.currentTarget.value } : x)) })} />
          <ActionIcon color="red" variant="subtle" onClick={() => set({ customAttributes: card.customAttributes.filter((_, j) => j !== i) })}>✕</ActionIcon>
        </Group>
      ))}
      <Button size="compact-xs" variant="subtle" onClick={() => set({ customAttributes: [...card.customAttributes, { key: '', value: '' }] })}>+ 添加属性</Button>
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
          <Divider label="版本历史（最近 20 份）" />
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

  const runNow = async () => {
    if (!sessionId || sessionId === 'new') {
      setLastResult('请先进入一个会话')
      return
    }
    setRunning(true)
    setLastResult('正在分析…')
    try {
      const r = await maybeAutoUpdateWorldBooks(sessionId, { force: true })
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
      <NumberInput
        label="分析最近消息数"
        value={settings.recentMessages}
        min={4}
        max={60}
        onChange={(v) => void updateModSettings({ recentMessages: Number(v) || 16 })}
      />
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

/* ======================== 小说分章 ======================== */

function NovelTab() {
  const sessionId = useAtomValue(currentSessionIdAtom)
  const [text, setText] = useState('')
  const [chapters, setChapters] = useState<Array<{ title: string; content: string }>>([])
  const [plans, setPlans] = useState<RewritePlan[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

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
    setMsg('正在续写…')
    try {
      const { getSessionSettings } = await import('@/stores/session/session-settings')
      const settings = await getSessionSettings(sessionId)
      const last = chapters.at(-1)
      const context = chapters.map((c) => `【${c.title}】${c.content}`).join('\n').slice(-8000)
      const out = await v27Continue(settings, context, '')
      setChapters([...chapters, { title: `第${cn(chapters.length + 1)}章（续）`, content: out }])
      setMsg('续写完成')
    } catch (e) {
      setMsg(`失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap="md">
      <Alert variant="light" title="小说分章 / 续写">
        粘贴正文 → 自动切章 → 生成 3 个改写方案 → 按方案重写末章 → 推入小说会话。续写可直接追加新章。
      </Alert>
      <Textarea label="正文（支持 第X章/Chapter N/楔子/番外 等标题切分）" autosize minRows={8} value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <Group>
        <Button size="xs" onClick={doSplit}>切章</Button>
        <Button size="xs" variant="default" onClick={() => void genPlans()} loading={busy} disabled={chapters.length === 0}>生成改写方案</Button>
        <Button size="xs" variant="default" onClick={() => void doContinue()} loading={busy} disabled={chapters.length === 0}>续写一章</Button>
        <Button size="xs" color="teal" onClick={() => void pushToSession()} loading={busy} disabled={chapters.length === 0}>推入小说会话</Button>
      </Group>
      {msg ? <Text size="sm">{msg}</Text> : null}
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
    </Stack>
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

  const doExport = async () => {
    const r = await exportModData()
    setRestoreResult(r.ok ? '已导出' : `导出失败：${r.error}`)
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
    </Stack>
  )
}
