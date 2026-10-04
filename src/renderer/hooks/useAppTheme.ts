import { createTheme, type ThemeOptions } from '@mui/material/styles'
import { getDefaultInterfaceColors, resolveInterfaceBrandColor } from '@shared/theme-colors'
import { useAtomValue } from 'jotai'
import { useLayoutEffect, useMemo } from 'react'
import { settingsStore, useLanguage, useSettingsStore } from '@/stores/settingsStore'
import { uiStore, useUIStore } from '@/stores/uiStore'
import { modSettingsAtom } from '@/modules/store'
import { type Language, Theme } from '../../shared/types'
import platform from '../platform'
import DesktopPlatform from '../platform/desktop_platform'

export const switchTheme = async (theme: Theme) => {
  let finalTheme = 'light' as 'light' | 'dark'
  if (theme === Theme.System) {
    finalTheme = (await platform.shouldUseDarkColors()) ? 'dark' : 'light'
  } else {
    finalTheme = theme === Theme.Dark ? 'dark' : 'light'
  }
  uiStore.setState({
    realTheme: finalTheme,
  })
  localStorage.setItem('initial-theme', finalTheme)
  if (platform instanceof DesktopPlatform) {
    await platform.switchTheme(finalTheme)
  }
}

export default function useAppTheme() {
  const theme = useSettingsStore((state) => state.theme)
  const interfaceColors = useSettingsStore((state) => state.interfaceColors ?? getDefaultInterfaceColors())
  const realTheme = useUIStore((state) => state.realTheme)
  const language = useLanguage()
  // Chatbox Mod: 聊天模式（群聊）强制深色主题 —— 统一 MUI / CSS 变量 / tailwind 三套系统
  const modChatMode = useAtomValue(modSettingsAtom).chatMode ?? 'creation'
  const effectiveTheme: 'light' | 'dark' = modChatMode === 'group' ? 'dark' : realTheme

  useLayoutEffect(() => {
    switchTheme(theme)
  }, [theme])

  useLayoutEffect(() => {
    platform.onSystemThemeChange(() => {
      const theme = settingsStore.getState().theme
      switchTheme(theme)
    })
  }, [])

  useLayoutEffect(() => {
    // update material-ui theme
    document.querySelector('html')?.setAttribute('data-theme', effectiveTheme)
    // update tailwindcss theme
    if (effectiveTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [effectiveTheme])

  useLayoutEffect(() => {
    const colors = interfaceColors[effectiveTheme]
    const brandColor = resolveInterfaceBrandColor(colors.brand, effectiveTheme)
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--chatbox-background-primary', colors.backgroundPrimary)
    rootStyle.setProperty('--chatbox-background-secondary', colors.backgroundSecondary)
    rootStyle.setProperty('--chatbox-background-tertiary', colors.backgroundTertiary)
    rootStyle.setProperty('--chatbox-brand', brandColor)
  }, [interfaceColors, effectiveTheme])

  const themeObj = useMemo(
    () =>
      createTheme(
        getThemeDesign(
          effectiveTheme,
          language,
          resolveInterfaceBrandColor(interfaceColors[effectiveTheme].brand, effectiveTheme)
        )
      ),
    [interfaceColors, language, effectiveTheme]
  )
  return themeObj
}

export function getThemeDesign(
  realTheme: 'light' | 'dark',
  language: Language,
  brandColor = getDefaultInterfaceColors()[realTheme].brand
): ThemeOptions {
  return {
    palette: {
      mode: realTheme,
      primary: {
        main: brandColor,
      },
      ...(realTheme === 'light'
        ? {}
        : {
            // MUI 内部无法处理 css 变量，需要使用具体颜色值
            background: {
              default: '#242424',
              paper: '#242424',
            },
          }),
    },
    components: {
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            backgroundColor: realTheme === 'dark' ? '#333333' : undefined,
            color: realTheme === 'dark' ? '#ffffff' : undefined,
          },
        },
      },
    },
    typography: {
      // In Chinese and Japanese the characters are usually larger,
      // so a smaller fontsize may be appropriate.
      ...(language === 'ar'
        ? {
            fontFamily: 'Cairo, Arial, sans-serif',
          }
        : {}),
      fontSize: 14,
    },
    direction: language === 'ar' ? 'rtl' : 'ltr',
    breakpoints: {
      values: {
        xs: 0,
        sm: 640, // 修改sm的值与tailwindcss保持一致
        md: 900,
        lg: 1200,
        xl: 1536,
      },
    },
  }
}
