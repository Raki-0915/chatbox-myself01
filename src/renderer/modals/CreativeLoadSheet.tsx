/**
 * Chatbox Mod —— 创作设置上拉板（底部弹层）
 *
 * 入口：对话页「对话设置」→「创作设置」
 * 能力：
 *  1. 装载世界书/人物卡到当前对话（仅「设置页-创作资料」中已启用的条目可选）
 *  2. 自动更新开关（对话结束后自动分析剧情进展，更新已装载条目）
 *
 * 数据层全部复用现有模块：
 *  - worldBooksAtom / characterCardsAtom（enabled 过滤 -> 可用库）
 *  - session.ts getBinding / setBinding（会话级装载，存 session.settings.worldBookIds/characterCardIds）
 *  - modSettingsAtom.autoUpdateEnabled（自动更新开关）
 */
import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Box, Button, Checkbox, Divider, Flex, Group, Modal, Stack, Switch, Text, UnstyledButton } from '@mantine/core'
import { IconBook2, IconBolt, IconUsers } from '@tabler/icons-react'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { characterCardsAtom, foldersAtom, modSettingsAtom, updateModSettings, worldBooksAtom } from '@/modules/store'
import { getBinding, setBinding } from '@/modules/session'
import type { ModFolder } from '@/modules/types'

interface SheetEntry {
  id: string
  name: string
  sub: string
  folderId?: string
}

function SheetSection(props: {
  icon: React.ReactNode
  title: string
  folders: ModFolder[]
  enabledEntries: SheetEntry[]
  disabledEntries: SheetEntry[]
  selected: string[]
  onToggle: (id: string) => void
  onGoEnable: () => void
  accent: string
}) {
  const { icon, title, folders, enabledEntries, disabledEntries, selected, onToggle, onGoEnable, accent } = props
  // 当前文件夹筛选：'all' 全部 / 'none' 未分类 / 文件夹 id
  const [folder, setFolder] = useState<string>('all')

  const allEntries = useMemo(() => [...enabledEntries, ...disabledEntries], [enabledEntries, disabledEntries])
  const counts = useMemo(() => {
    const none = allEntries.filter((i) => !i.folderId).length
    const byFolder = new Map<string, number>()
    for (const i of allEntries) {
      if (i.folderId) byFolder.set(i.folderId, (byFolder.get(i.folderId) ?? 0) + 1)
    }
    return { none, byFolder }
  }, [allEntries])
  const visible = (list: SheetEntry[]) =>
    folder === 'all' ? list : folder === 'none' ? list.filter((i) => !i.folderId) : list.filter((i) => i.folderId === folder)

  return (
    <Box>
      <Group gap={6} mb={6}>
        {icon}
        <Text fw={700} size="sm">
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          已装载 {selected.length}/{enabledEntries.length + disabledEntries.length}
        </Text>
      </Group>
      {/* 文件夹切换（模仿创作资料：全部 / 未分类 / 各文件夹；无文件夹时也显示 全部/未分类） */}
      <Group gap={6} wrap="wrap" mb={6}>
          {[
            { key: 'all', label: `全部(${allEntries.length})` },
            { key: 'none', label: `未分类(${counts.none})` },
            ...folders.map((f) => ({ key: f.id, label: `${f.name}(${counts.byFolder.get(f.id) ?? 0})` })),
          ].map((t) => (
            <Button
              key={t.key}
              size="compact-xs"
              variant={folder === t.key ? 'filled' : 'default'}
              onClick={() => setFolder(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </Group>
      <Stack gap={6}>
        {visible(enabledEntries).length === 0 && visible(disabledEntries).length === 0 ? (
          <Text size="xs" c="dimmed" py={6}>
            {allEntries.length === 0 ? '暂无条目，请先在「设置-创作资料」中新建。' : '当前文件夹下没有条目。'}
          </Text>
        ) : null}
        {visible(enabledEntries).map((e) => (
          <Flex
            key={e.id}
            align="center"
            gap="sm"
            px="sm"
            py={8}
            onClick={() => onToggle(e.id)}
            style={{ cursor: 'pointer', border: selected.includes(e.id) ? `1.5px solid ${accent}` : '1px solid var(--chatbox-border-primary, #e5e7eb)', borderRadius: 10, background: selected.includes(e.id) ? 'var(--chatbox-background-brand-secondary, #f0fdf4)' : 'transparent' }}
          >
            <Checkbox
              checked={selected.includes(e.id)}
              color="chatbox-brand"
              size="sm"
              aria-label={e.name}
              style={{ pointerEvents: 'none' }}
            />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={600} lineClamp={1}>
                {e.name}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {e.sub}
              </Text>
            </Box>
            <Text size="xs" c="chatbox-success" style={{ flex: '0 0 auto' }}>
              已启用
            </Text>
          </Flex>
        ))}
        {visible(disabledEntries).map((e) => (
          <Flex
            key={e.id}
            align="center"
            gap="sm"
            px="sm"
            py={8}
            style={{ border: '1px solid var(--chatbox-border-primary, #e5e7eb)', borderRadius: 10, opacity: 0.6 }}
          >
            <Checkbox disabled aria-label={e.name} size="sm" />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" c="dimmed" lineClamp={1}>
                {e.name}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {e.sub} · 未启用
              </Text>
            </Box>
            <UnstyledButton
              onClick={onGoEnable}
              style={{ flex: '0 0 auto', color: 'var(--chatbox-brand-color, #2563eb)', fontSize: 12, fontWeight: 600, padding: '4px 8px' }}
            >
              去设置页启用
            </UnstyledButton>
          </Flex>
        ))}
      </Stack>
    </Box>
  )
}

const CreativeLoadSheet = NiceModal.create(({ sessionId }: { sessionId: string }) => {
  const modal = useModal()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const wbAll = useAtomValue(worldBooksAtom)
  const ccAll = useAtomValue(characterCardsAtom)
  const folders = useAtomValue(foldersAtom)
  const modSettings = useAtomValue(modSettingsAtom)

  const [wbSel, setWbSel] = useState<string[]>([])
  const [ccSel, setCcSel] = useState<string[]>([])
  const [auto, setAuto] = useState<boolean>(modSettings.autoUpdateEnabled)
  const [confirm, setConfirm] = useState<boolean>(modSettings.requireConfirm)
  // 顶部并排标签：当前激活的页签（'wb' 世界书 / 'cc' 人物卡）
  const [tab, setTab] = useState<'wb' | 'cc'>('wb')

  // 打开时读取当前会话的装载状态（自动更新为对话级：会话有设置用会话值，否则回退全局）
  useEffect(() => {
    let alive = true
    void getBinding(sessionId).then((b) => {
      if (!alive) return
      setWbSel(b.worldBookIds)
      setCcSel(b.characterCardIds)
      if (b.autoUpdateEnabled !== undefined) setAuto(b.autoUpdateEnabled)
    })
    return () => {
      alive = false
    }
  }, [sessionId])

  const wbEnabled = useMemo(() => wbAll.filter((w) => w.enabled !== false), [wbAll])
  const wbDisabled = useMemo(() => wbAll.filter((w) => w.enabled === false), [wbAll])
  const ccEnabled = useMemo(() => ccAll.filter((c) => c.enabled !== false), [ccAll])
  const ccDisabled = useMemo(() => ccAll.filter((c) => c.enabled === false), [ccAll])

  const total = wbSel.length + ccSel.length

  const toggleWb = (id: string) =>
    setWbSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const toggleCc = (id: string) =>
    setCcSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const save = async () => {
    // 对话级保存：装载 + 自动更新开关写入当前会话 settings；写回前确认是全局设置
    await setBinding(sessionId, { worldBookIds: wbSel, characterCardIds: ccSel, autoUpdateEnabled: auto })
    await updateModSettings({ requireConfirm: confirm })
    modal.resolve(true)
    modal.remove()
  }

  const goEnable = () => {
    modal.remove()
    // to 为手工补齐的扩展路由（creative），不参与 TanStack 生成类型，需断言
    void navigate({ to: '/settings/creative' as any })
  }

  return (
    <Modal
      opened
      onClose={() => modal.remove()}
      withCloseButton={false}
      centered={false}
      padding={0}
      radius="lg"
      styles={{
        content: {
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          top: 'auto',
          width: '100%',
          maxHeight: '88vh',
          borderRadius: '16px 16px 0 0',
          margin: 0,
        },
        body: { padding: 0 },
      }}
      transitionProps={{ transition: 'slide-up', duration: 220 }}
    >
      <Box>
        {/* 头部 */}
        <Box px="md" pt="sm" pb="xs" style={{ borderBottom: '1px solid var(--chatbox-border-primary, #f0f1f3)' }}>
          <Flex justify="space-between" align="center">
            <Group gap={6}>
              <IconBook2 size={17} style={{ color: 'var(--chatbox-tint-secondary, #64748b)' }} />
              <Text fw={700} size="md">
                创作设置
              </Text>
            </Group>
            <UnstyledButton onClick={() => modal.remove()} aria-label="close" style={{ fontSize: 18, color: 'var(--chatbox-text-secondary, #9ca3af)', padding: 4 }}>
              ✕
            </UnstyledButton>
          </Flex>
          <Text size="xs" c="dimmed" mt={4}>
            仅显示「设置页已启用」的条目；勾选后装载到<b>当前对话</b>，其他对话不受影响。
          </Text>

          {/* 顶部并排标签：世界书 / 人物卡，点击切换下方内容 */}
          <Flex gap={8} pt="xs">
            {(
              [
                { key: 'wb', label: '世界书', count: wbSel.length, icon: <IconBook2 size={15} /> },
                { key: 'cc', label: '人物卡', count: ccSel.length, icon: <IconUsers size={15} /> },
              ] as { key: 'wb' | 'cc'; label: string; count: number; icon: React.ReactNode }[]
            ).map(({ key, label, count, icon }) => {
              const active = tab === key
              return (
                <UnstyledButton
                  key={key}
                  onClick={() => setTab(key)}
                  aria-pressed={active}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    borderRadius: 10,
                    textAlign: 'center',
                    background: active ? 'var(--chatbox-background-brand-secondary, #f0fdf4)' : 'transparent',
                    color: active ? 'var(--chatbox-brand-color, #2563eb)' : 'var(--chatbox-text-secondary, #6b7280)',
                    fontWeight: active ? 700 : 600,
                    fontSize: 14,
                    border: active ? '1.5px solid var(--chatbox-brand-color, #2563eb)' : '1px solid var(--chatbox-border-primary, #e5e7eb)',
                    transition: 'background .15s ease, color .15s ease',
                  }}
                >
                  <Group gap={6} justify="center">
                    {icon}
                    <Text inherit>{label}</Text>
                    <Text size="xs" c="dimmed">
                      ({count})
                    </Text>
                  </Group>
                </UnstyledButton>
              )
            })}
          </Flex>
        </Box>

        {/* 内容 */}
        <Box style={{ maxHeight: '62vh', overflow: 'auto' }}>
          <Stack px="md" py="sm" gap="md">
            {/* 按顶部标签切换：世界书 或 人物卡 */}
            {tab === 'wb' ? (
              <SheetSection
                icon={<IconBook2 size={15} style={{ color: 'var(--chatbox-tint-secondary, #64748b)' }} />}
                title="世界书"
                folders={folders.filter((f) => f.kind === 'wb')}
                enabledEntries={wbEnabled.map((w) => ({ id: w.id, name: w.name, sub: `${w.triggerMode === 'always' ? '始终注入' : '关键词触发'} · ${w.keywords?.length ? w.keywords.join('、') : '无关键词'}`, folderId: w.folderId }))}
                disabledEntries={wbDisabled.map((w) => ({ id: w.id, name: w.name, sub: w.triggerMode === 'always' ? '始终注入' : '关键词触发', folderId: w.folderId }))}
                selected={wbSel}
                onToggle={toggleWb}
                onGoEnable={goEnable}
                accent="#059669"
              />
            ) : (
              <SheetSection
                icon={<IconUsers size={15} style={{ color: 'var(--chatbox-tint-secondary, #64748b)' }} />}
                title="人物卡"
                folders={folders.filter((f) => f.kind === 'cc')}
                enabledEntries={ccEnabled.map((c) => ({ id: c.id, name: c.name, sub: `${c.occupation || '未知职业'}${c.gender ? ' · ' + c.gender : ''}`, folderId: c.folderId }))}
                disabledEntries={ccDisabled.map((c) => ({ id: c.id, name: c.name, sub: c.occupation || '未知职业', folderId: c.folderId }))}
                selected={ccSel}
                onToggle={toggleCc}
                onGoEnable={goEnable}
                accent="#059669"
              />
            )}
            <Divider />
            {/* 自动更新 */}
            <Group justify="space-between" align="flex-start" px="xs" py="xs">
              <Box style={{ flex: 1 }}>
                <Group gap={6}>
                  <IconBolt size={15} style={{ color: 'var(--chatbox-tint-secondary, #64748b)' }} />
                  <Text fw={600} size="sm">
                    自动更新
                  </Text>
                </Group>
                <Text size="xs" c="dimmed" mt={2}>
                  对话结束后自动分析剧情进展，更新已装载的世界书与人物卡内容
                </Text>
              </Box>
              <Switch
                checked={auto}
                onChange={(e) => setAuto(e.currentTarget.checked)}
                size="md"
                color="chatbox-brand"
              />
            </Group>
            <Group justify="space-between" align="flex-start" px="xs" pb="xs">
              <Box style={{ flex: 1 }}>
                <Text fw={500} size="sm">
                  写回前要求确认
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  分析完成后弹出「更新预览」窗口，确认后才写入世界书 / 人物卡
                </Text>
              </Box>
              <Switch
                checked={confirm}
                onChange={(e) => setConfirm(e.currentTarget.checked)}
                size="md"
                color="chatbox-brand"
              />
            </Group>
          </Stack>
        </Box>

        {/* 底部操作 */}
        <Box px="md" py="sm" style={{ borderTop: '1px solid var(--chatbox-border-primary, #f0f1f3)' }}>
          <Group gap="sm">
            <Button variant="default" style={{ flex: 1 }} onClick={() => modal.remove()}>
              {t('Cancel')}
            </Button>
            <Button color="chatbox-brand" style={{ flex: 2 }} onClick={() => void save()}>
              保存装载（{total}）
            </Button>
          </Group>
        </Box>
      </Box>
    </Modal>
  )
})

export default CreativeLoadSheet
