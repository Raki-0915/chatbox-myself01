import type { ModelProviderEnum, ProviderInfo, ProviderSettings } from '@shared/types'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseProviderFromJson } from '@/utils/provider-config'

export function useProviderImport(providers: ProviderInfo[]) {
  const { t } = useTranslation()
  const [importModalOpened, setImportModalOpened] = useState(false)
  const [importedConfig, setImportedConfig] = useState<
    ProviderInfo | (ProviderSettings & { id: ModelProviderEnum }) | null
  >(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [existingProvider, setExistingProvider] = useState<ProviderInfo | null>(null)

  const checkExistingProvider = useCallback(
    (providerId: string) => {
      const existing = providers.find((p) => p.id === providerId)
      if (existing) {
        setExistingProvider(existing)
      } else {
        setExistingProvider(null)
      }
    },
    [providers]
  )

  const handleClipboardImport = async () => {
    try {
      setIsImporting(true)
      setImportError(null)

      const text = await navigator.clipboard.readText()
      const error = handleTextImport(text)
      if (error) {
        setImportError(error)
      }
    } catch (err) {
      console.error('Clipboard import failed:', err)
      setImportError(t('Failed to read from clipboard'))
    } finally {
      setIsImporting(false)
    }
  }

  // [Chatbox Mod] 移动端入口：粘贴 JSON 文本导入（不走剪贴板，安卓 WebView readText 不可靠）
  // 返回 null=成功（已打开预览弹窗），非 null=错误信息（由调用方显示）
  const handleTextImport = useCallback(
    (text: string): string | null => {
      try {
        const config = parseProviderFromJson(text)

        if (!config) {
          return t('Invalid provider configuration format')
        }

        // Check if provider already exists
        checkExistingProvider(config.id)

        setImportedConfig(config)
        setImportModalOpened(true)
        return null
      } catch (err) {
        console.error('Text import failed:', err)
        return t('Invalid provider configuration format')
      }
    },
    [t, checkExistingProvider]
  )

  const handleCancelImport = () => {
    setImportModalOpened(false)
    setImportedConfig(null)
    setImportError(null)
    setExistingProvider(null)
  }

  return {
    importModalOpened,
    setImportModalOpened,
    importedConfig,
    setImportedConfig,
    importError,
    setImportError,
    isImporting,
    existingProvider,
    checkExistingProvider,
    handleClipboardImport,
    handleTextImport,
    handleCancelImport,
  }
}
