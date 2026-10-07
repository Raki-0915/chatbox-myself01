import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 语言生效副作用。
 *
 * 用户硬约束：界面必须简体中文，不接受英文。因此**不跟随** settings.language /
 * 系统语言 —— bootstrapRenderer 启动时的强制 `zh-Hans` 必须在此保持，
 * 否则 React 挂载后本 effect 会按持久化的英文设置把界面切回英文
 * （V17 复盘 4c 之后再次出现的根因）。
 */
export function useI18nEffect() {
  const { i18n } = useTranslation()
  useEffect(() => {
    void i18n.changeLanguage('zh-Hans')
    // 语言切换完全由本模块决定，不依赖 settings.language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
