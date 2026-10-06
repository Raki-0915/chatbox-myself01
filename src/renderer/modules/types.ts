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
  /** 冻结段（原文快照 + 字段归属，兼容旧 string 格式）：自动更新不得改写，按字段+原文匹配保护 */
  frozenTexts?: Array<{ field: string; text: string } | string>
}

/** 人物卡关系 */
export interface CharacterRelationship {
  targetName: string
  relation: string
  description?: string
}

/** 关联事件（角色知识库条目）：跟随人物卡、关键词触发、累积追加、可单条冻结 */
export interface AssociatedEvent {
  id: string
  /** 归属角色名（默认 = 人物卡 name） */
  roleName: string
  /** 事件内容（一句话剧情进展） */
  content: string
  /** 触发关键词：对话命中才注入上下文（按需注入，不占常驻） */
  keywords: string[]
  /** 发生时间（ms） */
  t: number
  /** 事件发生的原章节号（原著域「原作续改」注入筛选锚：只注入 chapter ≤ 当前节点关联章号的事件，未来事件不注入防剧透） */
  chapter?: number
  /** 单条冻结：true = 锁死，自动更新不得改写/删除 */
  frozen?: boolean
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
  /** 冻结段（原文快照 + 字段归属，兼容旧 string 格式）：自动更新不得改写，按字段+原文匹配保护 */
  frozenTexts?: Array<{ field: string; text: string } | string>
  /** 关联事件区（角色知识库）：剧情进展累积追加，绑定角色，关键词触发注入，只增不改 */
  associatedEvents?: AssociatedEvent[]
  /** 关联事件注入开关（默认开）：关掉后该卡的关联事件不注入上下文 */
  eventInjectionEnabled?: boolean
}

/** 设定文件夹（世界书/人物卡共用，kind 区分） */
export interface ModFolder {
  id: string
  name: string
  kind: 'wb' | 'cc'
}

/** 自动更新差异：模型算出的增/改/删，供「更新预览」弹窗确认后写回 */
export interface AutoUpdateDiff {
  wb: { add: Array<Record<string, unknown>>; update: Array<Record<string, unknown>>; remove: string[] }
  cc: { add: Array<Record<string, unknown>>; update: Array<Record<string, unknown>>; remove: string[] }
  /**
   * 关联事件追加（背景/事件分流）：剧情进展 → 对应角色事件区 append，只增不改。
   * append 项可带 _dedup 元数据（事件去重合并，见 event-dedup.ts）：
   *   - { score, targetId }            = 疑似重复，等待用户在预览中定夺（跳过/合并/仍新增）
   *   - { score, targetId, action:'merge' } = 用户选择「合并进原条目」→ 应用时执行合并
   * skip = 已判定的重复事件（自动跳过 / 预览中用户选择跳过），可展开查看、可一键恢复
   */
  events?: {
    append: Array<Record<string, unknown>>
    skip?: Array<{ item: Record<string, unknown>; targetId: string; score: number }>
  }
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
  /** 移动端模式：创作模式（现有对话模式改名，浅色主题）| 聊天模式（群聊，强制深色主题） */
  chatMode?: 'creation' | 'group'
  /** 事件判重敏感度：strict 严格 | standard 标准（默认）| loose 宽松 */
  eventDedupSensitivity?: 'strict' | 'standard' | 'loose'
}

/** 会话装载目标 */
export type ModTarget =
  | { mode: 'follow' }
  | { mode: 'fixed'; sid: string; name: string }

/** 对话存档分支点（Bookmark Branches）：会话级，独立于消息本体，删除消息时联动清理 */
export interface SessionBookmark {
  id: string
  sessionId: string
  messageId: string
  timestamp: number
  /** 用户备注（可选） */
  label?: string
  /** 消息内容简短预览 */
  preview: string
}

/* ======================== 原著域（原作续改）类型 ======================== */
/** 原著域与聊天域双域隔离：原著域只被「原作续改」改写页读取（bookId 命名空间、只读） */

/** 章节预告条目（原剧情预告 / 改写剧情预告通用：章号 + 标题 + 剧情梗概） */
export interface NovelPreviewItem {
  /** 章号（原著用数字 ch；改写线用 '改N'） */
  ch: number | string
  title: string
  brief: string
}

/** 原著章节节点（每章一条，只读） */
export interface NovelChapter {
  id: string
  bookId: string
  /** 原章节号（注入筛选的锚） */
  chIndex: number
  title: string
  /** 原文全文（只读，导入后锁定） */
  original: string
  /** 本章概要（1~2 句） */
  summary: string
  /** 原剧情预告：后续 N 章（条目可点击 → 跳转对应章节原文） */
  originalPreview: NovelPreviewItem[]
}

/** 人物卡静态基线（全书一致 · 只放不变设定；随剧情变化的进演化事件） */
export interface NovelCharacterBaseline {
  id: string
  bookId: string
  name: string
  backgroundStory: string
  keywords: string[]
  enabled: boolean
}

/** 角色演化事件（动态 · 按章累积；chapter 为注入筛选锚） */
export interface NovelEvent extends AssociatedEvent {
  bookId: string
}

/** 世界书条目（世界观 / 主线 / 伏笔，来源标注原著分析） */
export interface NovelWorldEntry extends WorldBookEntry {
  bookId: string
}

/** 改写线节点（可写 · 用户产物；引用原章节 ID，不复制原文） */
export interface NovelRewriteNode {
  id: string
  bookId: string
  /** 引用原著章节 ID（对照时按 ID 取原文，不复制） */
  refChapterId: string
  /** 关联原章号（注入筛选锚；改5-3 → 5） */
  chapter: number
  /** 节点标题（如 '5-3 改写版'） */
  title: string
  /** 改写版全文 */
  revised: string
  /** 剧情锚点：本章结束时剧情状态一句话（定位靠它，不靠章节号） */
  anchor: string
  /** 改写剧情预告：AI 推导，可手动编辑，推进时强约束注入 */
  revisedPreview: NovelPreviewItem[]
  /** draft / finalized */
  status: 'draft' | 'finalized'
  updatedAt: number
}

/** 原著库整体（bookId 命名空间根对象） */
export interface NovelBook {
  bookId: string
  bookName: string
  generatedFor: string
  /** 改写起点章节（默认第 1 章） */
  startChapter: number
  /** 预告章数（1~6，默认 3） */
  previewCount: number
  chapters: NovelChapter[]
  characterBaselines: NovelCharacterBaseline[]
  evolutionEvents: NovelEvent[]
  worldbook: NovelWorldEntry[]
  rewriteNodes: NovelRewriteNode[]
  /** 导入时间戳 */
  importedAt: number
}

