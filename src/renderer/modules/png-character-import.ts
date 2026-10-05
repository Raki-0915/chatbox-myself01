/**
 * PNG 人物卡导入（SillyTavern / Chub CCv3 兼容）
 *
 * 酒馆生态的「图即卡」：PNG 图片文件的 tEXt chunk 里藏了一段角色设定数据。
 * - Chub CCv3：tEXt chunk keyword = `ccv3`，value = 纯 JSON
 * - TavernAI 旧版：tEXt chunk keyword = `chara`，value = base64 编码的 JSON
 * 本模块负责：解析 PNG 二进制 → 提取 tEXt 数据 → 标准化为内部卡字段。
 * 全部为纯函数，便于回归测试。
 */

/** PNG 文件魔数（8 字节） */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** 判断字节流是否为 PNG 文件 */
export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false
  return true
}

/** tEXt chunk 条目 */
export interface PngTextChunk {
  keyword: string
  text: string
}

/**
 * 解析 PNG 二进制，提取全部 tEXt chunk（keyword → 文本）。
 * 只按 chunk 长度表遍历，不校验 CRC（读取阶段用不到）。
 */
export function parsePngTextChunks(bytes: Uint8Array): PngTextChunk[] {
  const out: PngTextChunk[] = []
  if (!isPngBytes(bytes)) return out
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 8 // 跳过签名
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off)
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
    const dataStart = off + 8
    const dataEnd = dataStart + len
    if (dataEnd + 4 > bytes.length) break // 数据不完整，终止
    if (type === 'tEXt') {
      // keyword\0text（keyword 为 latin1）
      let nul = -1
      for (let i = dataStart; i < dataEnd; i++) {
        if (bytes[i] === 0) {
          nul = i
          break
        }
      }
      if (nul >= 0) {
        const keyword = decodeLatin1(bytes.subarray(dataStart, nul))
        const text = decodeLatin1(bytes.subarray(nul + 1, dataEnd))
        out.push({ keyword, text })
      }
    }
    off = dataEnd + 4 // 跳过 CRC
    if (type === 'IEND') break
  }
  return out
}

/** latin1 解码（tEXt 文本按 ISO-8859-1 存储，中文卡会以 UTF-8 字节存入，需按 UTF-8 解码） */
function decodeLatin1(seg: Uint8Array): string {
  // 尝试 UTF-8 解码（现代卡基本都是 UTF-8 编码的 JSON）；失败时回退 latin1
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(seg)
  } catch {
    return new TextDecoder('latin1').decode(seg)
  }
}

/** 酒馆 CCv3 / TavernAI 卡的标准字段（JSON 结构） */
export interface TavernCardData {
  name?: string
  description?: string
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  system_prompt?: string
  post_history_instructions?: string
  creator?: string
  creator_notes?: string
  alternate_greetings?: string[]
  character_book?: {
    entries?: Array<{
      keys?: string[]
      content?: string
      comment?: string
      constant?: boolean
      enabled?: boolean
      depth?: number
      order?: number
    }>
  }
}

/** 从任意 JSON 对象提取酒馆卡字段（容忍字段缺失/类型异常） */
export function normalizeTavernCard(raw: unknown): TavernCardData | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const s = (v: unknown): string => (typeof v === 'string' ? v : '')
  const card: TavernCardData = {
    name: s(o.name),
    description: s(o.description),
    personality: s(o.personality),
    scenario: s(o.scenario),
    first_mes: s(o.first_mes),
    mes_example: s(o.mes_example),
    system_prompt: s(o.system_prompt),
    post_history_instructions: s(o.post_history_instructions),
    creator: s(o.creator),
    creator_notes: s(o.creator_notes),
  }
  if (Array.isArray(o.alternate_greetings)) {
    card.alternate_greetings = (o.alternate_greetings as unknown[])
      .filter((v) => typeof v === 'string')
      .map((v) => v as string)
  }
  const book = o.character_book as Record<string, unknown> | undefined
  if (book && Array.isArray(book.entries)) {
    card.character_book = {
      entries: (book.entries as unknown[])
        .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
        .map((e) => ({
          keys: Array.isArray(e.keys) ? (e.keys as unknown[]).filter((k) => typeof k === 'string').map((k) => k as string) : [],
          content: typeof e.content === 'string' ? e.content : '',
          comment: typeof e.comment === 'string' ? e.comment : '',
          constant: e.constant === true,
          enabled: e.enabled !== false,
          depth: typeof e.depth === 'number' ? e.depth : undefined,
          order: typeof e.order === 'number' ? e.order : undefined,
        })),
    }
  }
  // 必须有角色名才算有效卡
  if (!card.name || !card.name.trim()) return null
  return card
}

/** 解析 PNG 里的角色卡数据（ccv3 优先，其次 chara/base64） */
export function parseCharacterCardPng(bytes: Uint8Array): TavernCardData | null {
  const chunks = parsePngTextChunks(bytes)
  if (chunks.length === 0) return null
  // 1) ccv3：纯 JSON
  const ccv3 = chunks.find((c) => c.keyword === 'ccv3')
  if (ccv3) {
    try {
      const raw = JSON.parse(ccv3.text)
      const card = normalizeTavernCard(raw)
      if (card) return card
    } catch {
      /* 解析失败则继续尝试 chara */
    }
  }
  // 2) chara：base64 编码的 JSON（旧版 TavernAI），也可能是直接 JSON
  const chara = chunks.find((c) => c.keyword === 'chara')
  if (chara) {
    try {
      const b64 = chara.text.trim()
      const decoded = /^[A-Za-z0-9+/=]+$/.test(b64)
        ? new TextDecoder('utf-8').decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
        : chara.text
      const raw = JSON.parse(decoded)
      const card = normalizeTavernCard(raw)
      if (card) return card
    } catch {
      /* 非卡 */
    }
  }
  return null
}

/** 解析 JSON 文本形式的酒馆卡（.json 导出版，结构与 PNG 内嵌一致） */
export function parseCharacterCardJson(text: string): TavernCardData | null {
  try {
    const raw = JSON.parse(text)
    // 可能是 {data: ...} 或 {spec: 'chara_card_v2', data: ...} 包装
    const inner = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? raw.data : raw
    return normalizeTavernCard(inner)
  } catch {
    return null
  }
}

/** 人物卡 JSON 文本格式识别结果（A 阶段智能导入） */
export type CardJsonFormat = 'array' | 'ccv3' | 'tavern' | 'internal' | 'unknown'

/** 内部单卡独有特征字段（命中即视为本项目原生格式） */
const INTERNAL_FEATURE_KEYS = ['backgroundStory', 'age', 'characterBook', 'customAttributes'] as const
/** 酒馆顶层卡特征字段（命中且无内部特征时视为酒馆卡） */
const TAVERN_FEATURE_KEYS = ['description', 'personality', 'first_mes', 'scenario'] as const

/**
 * 识别人物卡 JSON 文本的格式，按优先级防误判：
 * 1. 数组 → 内部数组；2. 有 spec(chara_card_*) → CCv3；
 * 3. 有 data 且 data.name 为字符串 → CCv3 包装；4. 顶层有 name：
 *    含内部特征字段 → 内部单卡；否则含酒馆特征字段 → 酒馆卡；仅 name → 内部单卡（零回归）；
 * 5. 都不满足 → unknown（交给 readJsonArrayFile 兜底）。
 */
export function detectCardJsonFormat(text: string): CardJsonFormat {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'unknown'
  }
  if (Array.isArray(raw)) return 'array'
  if (!raw || typeof raw !== 'object') return 'unknown'
  const o = raw as Record<string, unknown>
  // 1.5) 导出包 {characterCards|worldBooks:[...]} → 按数组导入
  if (Array.isArray(o.characterCards) || Array.isArray(o.worldBooks)) return 'array'
  // 2) 有 spec（chara_card_v2 / v3）
  if (typeof o.spec === 'string' && o.spec.startsWith('chara_card_')) return 'ccv3'
  // 3) 有 data 且 data.name 为字符串 → CCv3 包装
  const data = o.data
  if (data && typeof data === 'object' && typeof (data as Record<string, unknown>).name === 'string') return 'ccv3'
  // 4) 顶层有 name
  if (typeof o.name === 'string') {
    if (INTERNAL_FEATURE_KEYS.some((k) => k in o)) return 'internal'
    if (TAVERN_FEATURE_KEYS.some((k) => typeof o[k] === 'string' && (o[k] as string).length > 0)) return 'tavern'
    return 'internal'
  }
  return 'unknown'
}

/** PNG 人物卡失败分级诊断分支（A 阶段） */
export type PngDiagnoseBranch = 'no-chunk' | 'no-keyword' | 'json-error' | 'no-name' | 'ok'
export interface PngDiagnoseResult {
  branch: PngDiagnoseBranch
  chunkCount?: number
  error?: string
}

/**
 * PNG 人物卡失败分级诊断：与 parseCharacterCardPng 共用同一判定顺序，
 * 返回失败具体分支（no-chunk / no-keyword / json-error / no-name / ok），UI 按分支提示。
 */
export function diagnosePngCard(bytes: Uint8Array): PngDiagnoseResult {
  const chunks = parsePngTextChunks(bytes)
  if (chunks.length === 0) return { branch: 'no-chunk' }
  const tryChunk = (chunk: { keyword: string; text: string } | undefined): PngDiagnoseResult | null => {
    if (!chunk) return null
    try {
      let raw: unknown
      if (chunk.keyword === 'chara') {
        const b64 = chunk.text.trim()
        raw = /^[A-Za-z0-9+/=]+$/.test(b64)
          ? new TextDecoder('utf-8').decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
          : chunk.text
      } else {
        raw = chunk.text
      }
      const card = normalizeTavernCard(JSON.parse(raw as string))
      if (!card) return { branch: 'no-name' }
      return { branch: 'ok' }
    } catch (e) {
      return { branch: 'json-error', error: String((e as Error)?.message ?? e) }
    }
  }
  const ccv3 = chunks.find((c) => c.keyword === 'ccv3')
  const ccv3Res = tryChunk(ccv3)
  if (ccv3Res) return ccv3Res
  const chara = chunks.find((c) => c.keyword === 'chara')
  const charaRes = tryChunk(chara)
  if (charaRes) return charaRes
  return { branch: 'no-keyword', chunkCount: chunks.length }
}

/**
 * 酒馆卡 → 本项目人物卡字段映射。
 * 返回 { fields, bookEntries }：
 * - fields：可直接铺到 CharacterCard 上的基础字段
 * - bookEntries：酒馆 character_book → 本项目世界书条目
 */
export function mapTavernCardToMod(card: TavernCardData): {
  fields: {
    name: string
    backgroundStory: string
    personalityType: string
    customAttributes: Array<{ key: string; value: string }>
  }
  bookEntries: Array<{
    name: string
    keywords: string[]
    content: string
    comment: string
    triggerMode: 'always' | 'keyword'
    depth: number
    order: number
    enabled: boolean
  }>
} {
  const attrs: Array<{ key: string; value: string }> = []
  const push = (key: string, value: string | undefined) => {
    const v = (value ?? '').trim()
    if (v) attrs.push({ key, value: v })
  }
  push('场景', card.scenario)
  push('开场白', card.first_mes)
  if (card.alternate_greetings?.length) push('备用开场白', card.alternate_greetings.join('\n\n---\n\n'))
  push('示例对话', card.mes_example)
  push('系统提示', card.system_prompt)
  push('剧情后提示', card.post_history_instructions)
  push('作者', card.creator)
  push('作者注释', card.creator_notes)

  const bookEntries = (card.character_book?.entries ?? []).map((e, i) => {
    const constant = e.constant === true
    return {
      name: e.keys?.[0] ?? `世界书条目 ${i + 1}`,
      keywords: e.keys ?? [],
      content: e.content ?? '',
      comment: e.comment ?? '',
      triggerMode: (constant ? 'always' : 'keyword') as 'always' | 'keyword',
      depth: typeof e.depth === 'number' ? e.depth : constant ? 0 : 1,
      order: typeof e.order === 'number' ? e.order : i,
      enabled: e.enabled !== false,
    }
  })

  return {
    fields: {
      name: (card.name ?? '').trim(),
      backgroundStory: (card.description ?? '').trim(),
      personalityType: (card.personality ?? '').trim(),
      customAttributes: attrs,
    },
    bookEntries,
  }
}
