/**
 * Chatbox Mod 模块 —— 共享类型定义
 *
 * 世界书/人物卡/文件夹/模块设置的领域模型。
 * 数据模型与 v48 版本保持兼容（字段名不变），便于数据迁移。
 */

/** 世界书条目 */
export interface WorldBookEntry {
  id: string
  name: string
  content: string
  keywords: string[]
  enabled: boolean
  /** 触发模式：always = 总是注入；keyword = 命中关键词才注入；regex = 命中正则才注入 */
  triggerMode?: 'always' | 'keyword' | 'regex'
  /** 注入顺序（升序） */
  order?: number
  /** 注入深度：0 = 常驻最前（always 默认）；1/2/3… = 触发后按深度分层（越近权重越大） */
  depth?: number
  folderId?: string
  createdAt?: number
  updatedAt?: number
  /** 版本历史（最近 20 份：自动更新/编辑覆盖前压入旧内容，可单条恢复） */
  history?: Array<{ t: number; content: string }>
}

/** 人物卡关系 */
export interface CharacterRelationship {
  targetName: string
  relation: string
  description?: string
}

/** 人物卡 */
export interface CharacterCard {
  id: string
  name: string
  age: string
  gender: string
  occupation: string
  appearance: string
  height: string
  weight: string
  distinguishingFeatures: string
  personalityType: string
  strengths: string
  weaknesses: string
  hobbies: string
  backgroundStory: string
  relationships: CharacterRelationship[]
  customAttributes: Array<{ key: string; value: string }>
  characterBook: WorldBookEntry[]
  /** 立绘头像（dataURL，来自 PNG 人物卡导入） */
  avatar?: string
  folderId?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** 版本快照（最近 20 份） */
  versionHistory: Array<{ version: number; timestamp: number; snapshot: string }>
}

/** 设定文件夹（世界书/人物卡共用，kind 区分） */
export interface ModFolder {
  id: string
  name: string
  kind: 'wb' | 'cc'
}

/** 自动更新事件日志 */
export interface ModLogEntry {
  t: number
  kind: 'auto-update' | 'apply' | 'manual-update' | string
  detail: unknown
  sid?: string | null
}

/** 自动更新备份快照 */
export interface ModBackup {
  t: number
  wbBack: Array<Pick<WorldBookEntry, 'id' | 'name' | 'content' | 'keywords' | 'enabled'>>
  ccBack: Array<Pick<CharacterCard, 'id' | 'name' | 'enabled'> & Partial<Omit<CharacterCard, 'id' | 'name' | 'enabled'>>>
  wbAddNames: string[]
  ccAddNames: string[]
}

/** 模块设置 */
export interface ModSettings {
  /** 自动更新总开关 */
  autoUpdateEnabled: boolean
  /** 自动更新需用户确认后才写回 */
  requireConfirm: boolean
  /** 每次自动更新分析的最近消息数 */
  recentMessages: number
  /** 备份保留份数 */
  backupLimit: number
  /** 世界书注入段落长度上限（字符） */
  wbInjectionLimit: number
  /** 人物卡注入段落长度上限（字符） */
  ccInjectionLimit: number
  /** 硅基流动（SiliconFlow）API Key（用户自填，仅本地保存） */
  siliconflowApiKey?: string
}

/** 会话装载目标 */
export type ModTarget =
  | { mode: 'follow' }
  | { mode: 'fixed'; sid: string; name: string }
