/**
 * Chatbox Mod 模块 —— 世界书标准格式导入（纯函数，可独立单测）
 *
 * 识别并转换 SillyTavern（酒馆）World Info 标准格式：
 * - JSON：条目数组，条目含 keys / content / constant / selective / insertion_order / enabled / position 等字段
 * - CSV：带 header（keys...,content,constant,selective,insertion_order,enabled,comment）或
 *        传统无 header 的 4~6 列（key[,key2]... ,content,constant,selective,order,comment）
 *
 * 转换映射到本项目世界书字段：
 * - keys -> keywords（多关键词）
 * - content -> content
 * - constant=true -> triggerMode='always' 且 depth=0（常驻）
 * - insertion_order / order -> order
 * - enabled -> enabled
 * - name：酒馆条目无 name，取 keys[0]；无 key 则取内容前 24 字
 */
import type { WorldBookEntry } from './types'

export type WorldInfoRow = Partial<WorldBookEntry> & { name: string; content: string; keywords: string[] }

/** 简易 CSV 行解析（支持双引号转义，分隔符逗号/分号） */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',' || ch === ';') {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function norm(s: string): string {
  return String(s ?? '').trim().toLowerCase()
}

/** 条目名兜底：keys[0] 或内容前 24 字 */
function nameOf(keys: string[], content: string, idx: number): string {
  const k = (keys ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)[0]
  if (k) return k.slice(0, 40)
  const c = String(content ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
  return c || `酒馆条目${idx + 1}`
}

/** 识别酒馆 World Info JSON 文本，返回转换后的条目；识别不了返回 null */
export function parseWorldInfoJson(text: string): WorldInfoRow[] | null {
  const t = String(text ?? '').trim()
  if (!t.startsWith('[') && !t.startsWith('{')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(t)
  } catch {
    return null
  }
  const arr = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : null
  if (!arr) return null
  // 特征检测：酒馆条目必有 keys 数组（或 key 字段）。仅含 content/enabled 的（如本项目导出包）不算酒馆格式
  const isWi = arr.some(
    (x) =>
      x &&
      typeof x === 'object' &&
      (Array.isArray((x as Record<string, unknown>).keys) || typeof (x as Record<string, unknown>).key === 'string'),
  )
  if (!isWi) return null
  return arr.map((raw, i) => {
    const it = (raw ?? {}) as Record<string, unknown>
    const keys = Array.isArray(it.keys)
      ? it.keys.map(String)
      : typeof it.key === 'string'
        ? it.key.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
        : []
    const content = String(it.content ?? '')
    const constant = it.constant === true || it.constant === 1 || it.constant === 'true'
    const order = Number(it.insertion_order ?? it.order ?? 0) || 0
    return {
      name: nameOf(keys, content, i),
      content,
      keywords: keys,
      triggerMode: constant ? ('always' as const) : ('keyword' as const),
      depth: constant ? 0 : Number(it.depth) || 1,
      order,
      enabled: it.enabled !== false,
    }
  })
}

/** 识别酒馆 World Info CSV 文本，返回转换后的条目；识别不了返回 null */
export function parseWorldInfoCsv(text: string): WorldInfoRow[] | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const first = parseCsvLine(lines[0])
  const hasHeader = first.some((c) => norm(c).includes('content')) && first.some((c) => norm(c).includes('key'))
  const rows = hasHeader ? lines.slice(1) : lines
  if (rows.length === 0) return null

  // 列定位（header 模式）
  let keyCols: number[] = []
  let contentCol = -1
  let constantCol = -1
  let orderCol = -1
  let enabledCol = -1
  if (hasHeader) {
    first.forEach((c, i) => {
      const n = norm(c)
      if (n === 'content') contentCol = i
      else if (n === 'constant') constantCol = i
      else if (n === 'insertion_order' || n === 'order') orderCol = i
      else if (n === 'enabled') enabledCol = i
      else if (n === 'key' || n.startsWith('key') || n === 'keys') keyCols.push(i)
    })
  } else {
    // 传统无 header：列数 4 -> key,content,constant,order；5 -> key,content,constant,selective,order；6+ -> keys...,content,constant,selective,order,comment
    const n = first.length
    if (n < 3) return null
    contentCol = n - 3
    constantCol = n - 2
    orderCol = n - 1
    for (let i = 0; i <= n - 4; i++) keyCols.push(i)
  }
  if (keyCols.length === 0 || contentCol < 0) return null

  const out: WorldInfoRow[] = []
  rows.forEach((line, i) => {
    const cells = parseCsvLine(line)
    const keys: string[] = []
    for (const kc of keyCols) {
      const v = cells[kc]
      if (!v) continue
      // 单格内可能含分号分隔多关键词
      keys.push(...v.split(/[;,]/).map((s) => s.trim()).filter(Boolean))
    }
    const content = cells[contentCol] ?? ''
    const constantRaw = constantCol >= 0 ? cells[constantCol] : ''
    const constant = /^(1|true|yes|是)$/i.test(constantRaw.trim())
    const order = Number(cells[orderCol] ?? 0) || 0
    const enabledRaw = enabledCol >= 0 ? cells[enabledCol] : ''
    const enabled = enabledRaw === '' ? true : !/^(0|false|no|否)$/i.test(enabledRaw.trim())
    if (!content && keys.length === 0) return
    out.push({
      name: nameOf(keys, content, i),
      content,
      keywords: keys,
      triggerMode: constant ? 'always' : 'keyword',
      depth: constant ? 0 : 1,
      order,
      enabled,
    })
  })
  return out.length ? out : null
}

/** 统一入口：识别文本是否为酒馆 World Info（JSON 或 CSV），是则返回转换条目，否则 null */
export function parseWorldInfo(text: string): WorldInfoRow[] | null {
  const j = parseWorldInfoJson(text)
  if (j) return j
  return parseWorldInfoCsv(text)
}
