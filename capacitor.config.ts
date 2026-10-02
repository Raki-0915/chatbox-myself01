import type { CapacitorConfig } from '@capacitor/cli'

/**
 * [Chatbox Mod] Capacitor 配置
 * webDir 指向 electron-vite renderer 构建产物。
 */
const config: CapacitorConfig = {
  appId: 'xyz.chatboxapp.chatbox',
  appName: 'Chatbox',
  webDir: 'release/app/dist/renderer',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
