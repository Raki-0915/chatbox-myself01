/**
 * Chatbox Mod 模块 —— 聊天记录导入
 *
 * 支持格式：
 * 1. 官方 Chatbox 导出的 Markdown（# 标题 / ## N. 线程名 / **role**: / ``` 内容 ```）
 * 2. 官方 Chatbox 导出的 TXT（==== [[会话名]] ==== / --- [N. 线程名] --- / ▶ ROLE: / 内容）
 * 3. 通用 JSON（[{role, content}] 或 {messages:[...]}）
 * 4. JSONL（每行 JSON，兼容 SillyTavern 酒馆聊天记录 [{name, is_user, mes}]）
 */
import { createMessage, MessageRoleEnum } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'

export type ImportedMessage = { role: 'user' | 'assistant' | 'system'; content: string }

export type ChatImportResult = {
  ok: boolean
  name?: string
  messages: ImportedMessage[]
  error?: string
  format: string
}

const ROLE_MAP: Record<string, 'user' | 'assistant' | 'system'> = {
  user: 'user',
  assistant: 'assistant',
  system: 'system',
  ai: 'assistant',
  human: 'user',
}

/** 从文本中提取所有 ``` 代码块内容（官方 Markdown 导出用代码块包消息文本） */
function extractMarkdownCodeBlocks(content: string): string[] {
  const blocks: string[] = []
  const re = /```[^\n]*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    blocks.push(m[1].trim())
  }
  return blocks
}

/** 解析官方 Markdown 导出 */
function parseMarkdownExport(content: string): ChatImportResult {
  const lines = content.split('\n')
  let name = ''
  const messages: ImportedMessage[] = []
  const firstLine = lines[0]?.trim() ?? ''
  if (firstLine.startsWith('# ')) {
    name = firstLine.slice(2).trim()
  }
  // 按 **role**: 分段，段内代码块为内容
  const re = /^\*\*(user|assistant|system|ai|human)\*\*:?\s*$/gim
  let lastIdx = 0
  let lastRole: 'user' | 'assistant' | 'system' | null = null
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const roleMatch = /^\*\*(user|assistant|system|ai|human)\*\*:?\s*$/i.exec(trimmed)
    if (roleMatch) {
      // flush 上一段
      if (lastRole) {
        const seg = lines.slice(lastIdx, i).join('\n')
        const blocks = extractMarkdownCodeBlocks(seg)
        const text = blocks.length > 0 ? blocks.join('\n\n') : seg.trim()
        if (text) messages.push({ role: lastRole, content: text })
      }
      lastRole = ROLE_MAP[roleMatch[1].toLowerCase()] ?? 'assistant'
      lastIdx = i + 1
    }
  }
  if (lastRole) {
    const seg = lines.slice(lastIdx).join('\n')
    const blocks = extractMarkdownCodeBlocks(seg)
    const text = blocks.length > 0 ? blocks.join('\n\n') : seg.trim()
    if (text) messages.push({ role: lastRole, content: text })
  }
  return { ok: messages.length > 0, name: name || undefined, messages, format: 'Markdown' }
}

/** 解析官方 TXT 导出 */
function parseTxtExport(content: string): ChatImportResult {
  const reSession = /={10,}\s*\[\[(.*?)\]\]\s*={10,}/
  const sessionMatch = reSession.exec(content)
  const name = sessionMatch ? sessionMatch[1].trim() : ''
  const messages: ImportedMessage[] = []
  // 分段：▶ USER: / ▶ ASSISTANT: / ▶ SYSTEM: 前缀行之后的内容
  const segRe = /^▶\s*(USER|ASSISTANT|SYSTEM|AI|HUMAN)\s*:\s*$/gim
  const lines = content.split('\n')
  let lastRole: 'user' | 'assistant' | 'system' | null = null
  let buf: string[] = []
  const flush = () => {
    if (lastRole) {
      const text = buf.join('\n').trim()
      if (text) messages.push({ role: lastRole, content: text })
    }
    buf = []
  }
  for (const line of lines) {
    const m = /^▶\s*(USER|ASSISTANT|SYSTEM|AI|HUMAN)\s*:\s*$/i.exec(line.trim())
    if (m) {
      flush()
      lastRole = ROLE_MAP[m[1].toLowerCase()] ?? 'assistant'
    } else {
      buf.push(line)
    }
  }
  flush()
  return { ok: messages.length > 0, name: name || undefined, messages, format: 'TXT' }
}

/** 解析通用 JSON / JSONL（兼容酒馆 SillyTavern 聊天记录） */
function parseJsonImport(content: string, isJsonl: boolean): ChatImportResult {
  const messages: ImportedMessage[] = []
  let name: string | undefined
  const pushItem = (raw: unknown, lineNo: number) => {
    if (!raw || typeof raw !== 'object') return
    const item = raw as Record<string, unknown>
    // 酒馆格式：{ name, is_user, mes }
    if (typeof item.mes === 'string') {
      const role = item.is_user === true ? 'user' : 'assistant'
      const text = (item.mes as string).trim()
      if (text) messages.push({ role, content: text })
      return
    }
    // 通用格式：{ role, content }
    const roleRaw = String(item.role ?? '').toLowerCase()
    const role = ROLE_MAP[roleRaw]
    let text = ''
    if (typeof item.content === 'string') {
      text = item.content
    } else if (Array.isArray(item.content)) {
      // 兼容 contentParts 数组
      text = (item.content as unknown[])
        .map((p) => {
          if (p && typeof p === 'object' && (p as Record<string, unknown>).type === 'text') {
            return String((p as Record<string, unknown>).text ?? '')
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
    } else if (typeof item.text === 'string') {
      text = item.text
    }
    if (role && text.trim()) {
      messages.push({ role, content: text.trim() })
    } else if (!role && text.trim()) {
      // 无 role 字段（可能是 {name, text} 酒馆变体）
      messages.push({ role: item.is_user === true ? 'user' : 'assistant', content: text.trim() })
    }
    // 顶层 name
    if (!name && typeof item.name === 'string' && !item.mes && !item.role) {
      // 会话名对象 { name, messages: [...] }
      name = (item.name as string).trim()
    }
  }

  if (isJsonl) {
    const lineNo: number[] = []
    content.split('\n').forEach((line, i) => {
      const t = line.trim()
      if (!t) return
      try {
        const obj = JSON.parse(t)
        if (Array.isArray(obj)) {
          obj.forEach((o) => pushItem(o, i + 1))
        } else {
          pushItem(obj, i + 1)
        }
      } catch {
        void lineNo
      }
    })
  } else {
    try {
      const obj = JSON.parse(content)
      if (Array.isArray(obj)) {
        obj.forEach((o, i) => pushItem(o, i + 1))
      } else if (obj && typeof obj === 'object') {
        // { messages: [...] } 或酒馆整个会话对象
        const rec = obj as Record<string, unknown>
        if (Array.isArray(rec.messages)) {
          ;(rec.messages as unknown[]).forEach((o, i) => pushItem(o, i + 1))
        } else if (typeof rec.name === 'string') {
          name = (rec.name as string).trim()
        }
        // 酒馆对象可能带 chats 字段
        if (Array.isArray(rec.chats)) {
          ;(rec.chats as unknown[]).forEach((o, i) => pushItem(o, i + 1))
        }
        if (Array.isArray(rec.mes)) {
          ;(rec.mes as unknown[]).forEach((o, i) => pushItem(o, i + 1))
        }
      }
    } catch {
      return { ok: false, messages: [], format: isJsonl ? 'JSONL' : 'JSON', error: '文件不是有效的 JSON' }
    }
  }
  return { ok: messages.length > 0, name, messages, format: isJsonl ? 'JSONL' : 'JSON' }
}

/**
 * 主入口：解析导入文件文本 → 消息列表
 */
export function parseChatImport(content: string, filename: string): ChatImportResult {
  const lower = filename.toLowerCase()
  const trimmed = content.trim()
  if (!trimmed) {
    return { ok: false, messages: [], format: 'Unknown', error: '文件为空' }
  }
  if (lower.endsWith('.jsonl')) {
    return parseJsonImport(trimmed, true)
  }
  if (lower.endsWith('.json')) {
    return parseJsonImport(trimmed, false)
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return parseMarkdownExport(trimmed)
  }
  if (lower.endsWith('.txt')) {
    return parseTxtExport(trimmed)
  }
  // 未知扩展名：先试 JSON，再试 TXT/Markdown
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const j = parseJsonImport(trimmed, false)
    if (j.ok) return j
  }
  const txt = parseTxtExport(trimmed)
  if (txt.ok) return txt
  const md = parseMarkdownExport(trimmed)
  if (md.ok) return md
  return { ok: false, messages: [], format: 'Unknown', error: '无法识别的聊天记录格式' }
}

/** 将导入消息转为官方 Message 对象数组（系统提示词保留并置于最前） */
export function toSessionMessages(imported: ImportedMessage[]) {
  // 系统提示词（role='system'）必须保留并置于最前——Chatbox 约定会话的系统提示词
  // 是消息列表第一条 system 消息；丢掉它 = 导入后系统提示词丢失。
  const system = imported.filter((m) => m.role === 'system')
  const rest = imported.filter((m) => m.role === 'user' || m.role === 'assistant')
  return [
    ...system.map((m) => createMessage(MessageRoleEnum.System, m.content)),
    ...rest.map((m) => createMessage(m.role === 'user' ? MessageRoleEnum.User : MessageRoleEnum.Assistant, m.content)),
  ]
}

/** 生成导入会话 ID */
export function makeImportSessionId(): string {
  return uuidv4()
}
