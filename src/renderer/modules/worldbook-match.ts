/**
 * Chatbox Mod 模块 —— 世界书匹配（纯函数，无运行时依赖，可独立单测）
 *
 * 触发规则：
 * - always：始终注入
 * - keyword：对话文本包含任一关键词（子串匹配）
 * - regex：对话文本命中正则（大小写不敏感；非法正则回退为关键词包含匹配）
 */
import type { WorldBookEntry } from './types'

/** 匹配单个世界书条目（dt 为已小写化的对话文本） */
export function matchWorldBookEntry(x: WorldBookEntry, dt: string): boolean {
  if (!x.triggerMode || x.triggerMode === 'always') return true
  if (x.triggerMode === 'regex') {
    const p = Array.isArray(x.keywords) ? String(x.keywords[0] ?? '') : ''
    if (!p) return false
    try {
      return new RegExp(p, 'i').test(dt)
    } catch {
      // 非法正则：回退为该条目关键词包含匹配，避免条目静默失效
      return (x.keywords ?? []).some((k) => String(k).toLowerCase() && dt.includes(String(k).toLowerCase()))
    }
  }
  // %条目名% 引用不参与普通包含匹配（仅用于递归激活），从关键词中剔除后匹配
  const kws = Array.isArray(x.keywords)
    ? x.keywords
        .map((k) => String(k).replace(/%[^%]+%/g, ' ').toLowerCase())
        .filter(Boolean)
    : []
  return kws.some((k) => dt.includes(k))
}

/** 提取条目关键词里的 %条目名% 引用 */
export function refsOf(x: WorldBookEntry): string[] {
  const out: string[] = []
  for (const k of x.keywords ?? []) {
    const m = /%([^%]+)%/g.exec(String(k))
    if (m) out.push(m[1].trim())
  }
  return out
}

/**
 * 场景条目 + %条目名% 递归展开：
 * - 先按触发规则取命中条目；
 * - 命中条目的关键词里若有 %其他条目名%，递归拉入被引用条目（强制激活，即使其自身未触发）；
 * - 深度上限 3、visited 防环；always/depth0 常驻条目不参与场景递归。
 */
export function expandSceneEntries(entries: WorldBookEntry[], dialogText: string): WorldBookEntry[] {
  const dt = String(dialogText ?? '').toLowerCase()
  const valid = entries.filter(
    (x) => x && x.enabled !== false && (x.content ?? '').trim() && !(x.triggerMode === 'always' || x.depth === 0),
  )
  const hit = valid.filter((x) => matchWorldBookEntry(x, dt))
  if (hit.length === 0) return []
  const byName = new Map<string, WorldBookEntry>()
  for (const e of entries) if (e.name) byName.set(e.name.trim().toLowerCase(), e)
  const out = new Map<string, WorldBookEntry>()
  const visit = (list: WorldBookEntry[], depth: number, visited: Set<string>) => {
    if (depth > 3) return
    for (const e of list) {
      const key = e.id || e.name
      if (visited.has(key)) continue
      visited.add(key)
      out.set(key, e)
      const refs = refsOf(e)
      if (refs.length) {
        const targets = refs
          .map((r) => byName.get(r.toLowerCase()))
          .filter(
            (x): x is WorldBookEntry =>
              Boolean(
                x && x.enabled !== false && (x.content ?? '').trim() && !(x.triggerMode === 'always' || x.depth === 0),
              ),
          )
        if (targets.length) visit(targets, depth + 1, visited)
      }
    }
  }
  visit(hit, 0, new Set())
  return [...out.values()]
}

/**
 * 注入体积自适应：对话越长，注入预算越小。
 * 防长对话被设定挤爆上下文；保底 800 字符保证常驻设定始终有空间。
 */
export function adaptiveInjectionBudget(baseLimit: number, dialogLen: number): number {
  const b = Math.max(0, baseLimit - Math.floor(dialogLen / 4))
  return Math.max(800, b)
}

/** 世界书内容 → 注入段落（关键词/正则/始终触发 + order 排序） */
export function buildWorldBookSection(entries: WorldBookEntry[], dialogText: string, limit: number): string {
  const dt = String(dialogText ?? '').toLowerCase()
  const hit = entries
    .filter((x) => x && x.enabled !== false && (x.content ?? '').trim())
    .filter((x) => matchWorldBookEntry(x, dt))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  if (hit.length === 0) return ''
  const body = hit.map((x) => `### ${x.name}\n${x.content.trim()}`).join('\n\n')
  const sliced = body.slice(0, limit)
  return sliced ? `## World Book\n${sliced}` : ''
}

/**
 * 世界书分层注入（简化深度版）：
 * - 常驻段（resident）：always 或 depth===0 的条目，每轮必带，放 system 前部（模型注意力最高）
 * - 场景段（scene）：触发命中的 keyword/regex 条目（depth>=1），按 depth 升序、同深度按 order 升序
 * 旧数据兼容：未设 depth 的 always → 常驻；未设 depth 的触发条目 → 场景（视为 depth 1）
 */
export function splitWorldBookSections(
  entries: WorldBookEntry[],
  dialogText: string,
  limit: number,
): { resident: string; scene: string } {
  const dt = String(dialogText ?? '').toLowerCase()
  const valid = entries.filter((x) => x && x.enabled !== false && (x.content ?? '').trim())
  const fmt = (list: WorldBookEntry[]): string => list.map((x) => `### ${x.name}\n${x.content.trim()}`).join('\n\n')

  const resident = fmt(
    valid
      .filter((x) => x.triggerMode === 'always' || x.depth === 0) // 显式 depth 0 才常驻；旧数据 undefined 视为场景
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  ).slice(0, limit)
  const scene = fmt(
    expandSceneEntries(valid, dt)
      .filter((x) => !(x.triggerMode === 'always' || x.depth === 0))
      .sort((a, b) => (a.depth ?? 1) - (b.depth ?? 1) || (a.order ?? 0) - (b.order ?? 0)),
  ).slice(0, limit)
  return { resident, scene }
}
