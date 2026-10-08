import { Button, Stack, Text, Textarea } from '@mantine/core'
import { IconFileImport } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'

interface ImportProviderTextModalProps {
  opened: boolean
  onClose: () => void
  // 返回 null=解析成功（预览弹窗会打开），非 null=错误信息（在弹窗内显示）
  onImport: (text: string) => string | null
}

// [Chatbox Mod] 移动端提供商 JSON 导入：粘贴 JSON 文本 → 解析 → 复用 ImportProviderModal 预览确认
// 官方桌面版用 navigator.clipboard.readText（安卓 WebView 不可靠），移动端改手动粘贴
export function ImportProviderTextModal({ opened, onClose, onImport }: ImportProviderTextModalProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const handleParse = async () => {
    if (!text.trim() || importing) return
    setImporting(true)
    setError(null)
    // 让 hook 先完成 state 更新再关闭当前弹窗（预览弹窗依赖同一批 state）
    await new Promise((resolve) => setTimeout(resolve, 0))
    const result = onImport(text)
    setImporting(false)
    if (result === null) {
      setText('')
      onClose()
    } else {
      setError(result)
    }
  }

  const handleClose = () => {
    setError(null)
    setText('')
    onClose()
  }

  return (
    <AdaptiveModal
      opened={opened}
      onClose={handleClose}
      title={t('Import Provider Configuration')}
      centered
      size="lg"
      styles={{
        content: {
          borderRadius: '12px',
        },
        header: {
          borderBottom: 'none',
          paddingBottom: 0,
        },
        body: {
          paddingTop: 0,
        },
      }}
    >
      <Stack gap="md">
        {error ? (
          <Text size="sm" c="chatbox-error">
            {error}
          </Text>
        ) : null}

        <Text size="sm" c="chatbox-tint-secondary">
          {t('Paste provider config JSON below')}
        </Text>

        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value)
            setError(null)
          }}
          placeholder='{"isCustom":true,"id":"my-provider","name":"My Provider","type":"openai","settings":{"apiHost":"https://api.example.com","apiKey":"sk-..."}}'
          minRows={8}
          autosize
          spellCheck={false}
          data-testid="provider-config-textarea"
        />

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={handleClose} />
          <Button
            onClick={handleParse}
            disabled={!text.trim() || importing}
            loading={importing}
            leftSection={<ScalableIcon icon={IconFileImport} size={18} />}
          >
            {t('Parse')}
          </Button>
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
}
