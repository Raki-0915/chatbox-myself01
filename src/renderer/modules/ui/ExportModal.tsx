/**
 * Chatbox Mod —— 通用导出对话框
 *
 * 支持“编辑导出文件名 + 选择保存到指定路径”：
 * - 文件名：对话框内文本输入，预填默认名，可自行修改。
 * - 保存路径：点“导出”后
 *     · Web 浏览器 → 优先弹出系统“另存为”（showSaveFilePicker），可编辑文件名并选择保存目录；
 *     · Android / 桌面 → 复用官方 exporter（SAF 系统保存对话框 / 桌面原生对话框），天然支持改文件名与选位置。
 */
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { useEffect, useState } from 'react'
import { exportJsonWithPath } from '../export'

export interface ExportModalConfig {
  defaultName: string
  makeBlob: () => Promise<Blob> | Blob
}

interface ExportModalProps {
  opened: boolean
  onClose: () => void
  title: string
  defaultName?: string
  makeBlob?: () => Promise<Blob> | Blob
  description?: string
  /** 导出尝试结束后回调（ok=是否成功，msg=结果文案） */
  onDone?: (ok: boolean, msg: string) => void
}

export function ExportModal({ opened, onClose, title, defaultName = '', makeBlob, description, onDone }: ExportModalProps) {
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // 每次打开时重置为本次默认文件名
  useEffect(() => {
    if (opened) {
      setName(defaultName)
      setMsg('')
    }
  }, [opened, defaultName])

  const doExport = async () => {
    if (!makeBlob) return
    setBusy(true)
    setMsg('')
    try {
      const finalName = name.trim() || defaultName || 'chatbox-mod-export.json'
      const blob = await makeBlob()
      const r = await exportJsonWithPath(finalName, blob)
      if (r.canceled) {
        setMsg('已取消')
        onClose()
      } else if (r.ok) {
        const okMsg = `已导出：${finalName}`
        setMsg(okMsg)
        onDone?.(true, okMsg)
        onClose()
      } else {
        const errMsg = `导出失败：${r.error}`
        setMsg(errMsg)
        onDone?.(false, errMsg)
      }
    } catch (e) {
      const errMsg = `导出异常：${String((e as Error)?.message ?? e)}`
      setMsg(errMsg)
      onDone?.(false, errMsg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {description ?? '可修改导出文件名；点击导出后按系统提示选择保存到指定位置。'}
        </Text>
        <TextInput
          label="导出文件名"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="例如 chatbox-mod-data.json"
          autoFocus
          data-autofocus
        />
        {msg && (
          <Text size="sm" c={msg.startsWith('导出失败') || msg.startsWith('导出异常') ? 'red' : 'green'}>
            {msg}
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void doExport()} loading={busy}>
            导出
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
