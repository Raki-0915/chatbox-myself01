/**
 * Chatbox Mod 模块 —— 冻结段保护（纯函数，无 JSX）
 *
 * 世界书/人物卡编辑页可「冻结选中文字」：冻结段存原文快照并带字段归属
 * （{field, text}），自动更新生成端被告知不得改写，应用端再做硬保护。
 * 兼容旧数据：纯 string 元素视为任意字段（V15 旧格式，仅存在于当时的冻结入口字段）。
 *
 * 保护语义（v2，修复「冻结段被改写后残留原位」的问题）：
 * 1. AI 新内容整段原样保留冻结段 → 不动；
 * 2. 仅空白/大小写差异（norm 后整段仍在）→ 视为保留；
 * 3. AI 改写/增删了冻结段内的字 → 按行/跨行窗口相似匹配，原位替换回冻结原文
 *    （不再只是「末尾补回一份」，避免被改写残留留在原位造成「看着被改了」）；
 * 4. AI 彻底删除且找不到相似段落 → 末尾补回（兜底）。
 */

import { similarityRatio } from './text-similarity'

export interface FrozenSegment {
  field: string
  text: string
}

/** 改写还原相似度阈值（bigram Dice）：段落与冻结段 ≥ 此值视为「被改写的冻结段」 */
const SIM_REPLACE = 0.65

/** LCS 比例阈值：冻结段字符按序保留 ≥60% 视为被改写（比 bigram Dice 更抗稀释） */
const LCS_REPLACE = 0.6

/** 相似度替换的长度约束：规范化长度差异 ≤40% 才允许按相似度替换，防误伤不同内容 */
const LEN_TOL = 0.4

/** 规范化（去空白、小写）用于宽松匹配 */
function normForMatch(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 最长公共子序列比例（0~1）：b 的字符按序在 a 中出现的比例；超长输入回退 0（防 O(mn) 爆炸） */
function lcsRatio(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  const m = a.length
  const n = b.length
  if (m * n > 40000) return 0
  const dp = new Uint16Array(n + 1)
  let max = 0
  for (let i = 1; i <= m; i++) {
    let prev = 0
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cur = dp[j]
      if (ai === b.charCodeAt(j - 1)) {
        dp[j] = prev + 1
        if (dp[j] > max) max = dp[j]
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1])
      }
      prev = cur
    }
  }
  // 语义：冻结段 b 的字符按序在段落 a 中保留的比例 → 分母取 len(b)（冻结段长度）
  return max / Math.min(m, n)
}

/** 判断段落 np 是否为冻结段 nf 的「被改写版本」 */
function isRewritten(np: string, nf: string): boolean {
  if (np.includes(nf) || nf.includes(np)) return true
  // 冻结段字符按序大多保留（≥60%）→ 被改写（抗「冻结段是句内片段、行含其它内容」的稀释）。
  // 冻结段过短（<4 字）时 LCS 比例易被偶然字符命中误伤，只走整段匹配/补回。
  if (nf.length >= 4 && lcsRatio(np, nf) >= LCS_REPLACE) return true
  // 长度接近的整行高相似（Dice 兜底）
  const lenOk = Math.abs(np.length - nf.length) / Math.max(1, nf.length) <= LEN_TOL
  if (lenOk && similarityRatio(np, nf) >= SIM_REPLACE) return true
  return false
}

/** 规范化：兼容旧 string 格式 → 按给定 field 归属 */
function norm(list: Array<string | FrozenSegment> | undefined, field: string): FrozenSegment[] {
  return (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? { field, text: x.trim() } : { ...x, text: x.text.trim() }))
}

/**
 * toggle 冻结（按字段）：选中文本若已在该字段冻结列表则移除（取消冻结），否则加入。
 * 空/空白文本不冻结。
 */
export function toggleFrozen(list: Array<string | FrozenSegment> | undefined, field: string, selection: string): FrozenSegment[] {
  const t = selection.trim()
  if (!t) return norm(list, field)
  const arr = norm(list, field)
  const idx = arr.findIndex((x) => x.field === field && x.text === t)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push({ field, text: t })
  return arr
}

/** 在被改写的内容里找冻结段：单行匹配（冻结段为单行时） */
function replaceSingleLine(lines: string[], used: Set<number>, frozenText: string, nf: string): boolean {
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    const line = lines[i]
    const np = normForMatch(line)
    if (!np) continue
    // 行包含冻结段（AI 保留原文又加前后缀）或高度相似（AI 改了字）→ 行内还原
    if (isRewritten(np, nf)) {
      // 首尾夹取：行内从 nf 首字符到末字符的子串即「被改写的冻结段区域」，
      // 只替换该区域，保留行内未冻结的前缀/后缀（如「东周女帝帝释天。」、「新增设定。」）
      const firstCh = nf[0]
      const lastCh = nf[nf.length - 1]
      const start = line.indexOf(firstCh)
      const end = line.lastIndexOf(lastCh)
      if (start >= 0 && end > start) {
        lines[i] = line.slice(0, start) + frozenText + line.slice(end + 1)
      } else {
        // 找不到首尾字符（罕见）→ 整行还原，冻结优先
        lines[i] = frozenText
      }
      used.add(i)
      return true
    }
  }
  return false
}

/** 多行冻结段：跨行窗口匹配（最多 12 行），命中则整个窗口替换为冻结原文 */
function replaceMultiLine(lines: string[], used: Set<number>, frozenText: string, nf: string): boolean {
  const L = lines.length
  for (let i = 0; i < L; i++) {
    if (used.has(i)) continue
    let seg = ''
    for (let w = 1; w <= 12 && i + w <= L; w++) {
      seg = seg ? `${seg}\n${lines[i + w - 1]}` : lines[i]
      const ns = normForMatch(seg)
      if (!ns) continue
      if (isRewritten(ns, nf)) {
        lines.splice(i, w, frozenText)
        return true
      }
    }
  }
  return false
}

/** 字段是否存在冻结段（非空白文本） */
export function hasFrozenOnField(list: Array<string | FrozenSegment> | undefined, field: string): boolean {
  return norm(list, field).some((x) => x.field === field && !!x.text)
}

/**
 * 字段级硬锁（v3，升级保护语义）：
 * - 字段存在冻结段 → 整个字段保持旧值（AI 既不能改写冻结段，也不能在字段里追加新内容）
 * - 字段无冻结段 → 照常采用 AI 新内容
 * 由自动更新写回处传入「更新前旧值」实现整体回退。
 */
export function applyFrozenLock(
  newText: string,
  oldText: string,
  frozenList: Array<string | FrozenSegment> | undefined,
  field: string
): string {
  return hasFrozenOnField(frozenList, field) ? oldText : newText
}

/**
 * 应用端硬保护（按字段，原文快照 + 相似还原 + 末尾补回）：
 * - AI 新内容中保留/仅空白差异包含的冻结段 → 原样保留（不剥离、不移动）
 * - 被 AI 改写的冻结段 → 原位替换回冻结原文（不再残留改写版）
 * - 被 AI 彻底删除的冻结段 → 按冻结顺序原文补回末尾
 * - 未冻结部分照常采用 AI 新内容；其它字段的冻结段不影响本字段
 * 注：自动更新写回已改用字段级硬锁 applyFrozenLock；本函数保留供非锁场景使用。
 */
export function applyFrozenProtection(
  newText: string,
  frozenList: Array<string | FrozenSegment> | undefined,
  field: string
): string {
  const mine = norm(frozenList, field)
    .filter((x) => x.field === field)
    .map((x) => x.text)
    .filter(Boolean)
  if (mine.length === 0) return newText
  const t = String(newText ?? '')
  const tNorm = normForMatch(t)
  const lines = t.split('\n')
  const used = new Set<number>()
  const missing: string[] = []
  for (const f of mine) {
    // 1) 整段原文在 → 保留
    if (t.indexOf(f) >= 0) continue
    const nf = normForMatch(f)
    if (!nf) continue
    // 2) 仅空白/大小写差异，整段仍在 → 保留
    if (tNorm.includes(nf)) continue
    // 3) 被改写 → 原位还原
    const replaced = f.includes('\n')
      ? replaceMultiLine(lines, used, f, nf)
      : replaceSingleLine(lines, used, f, nf)
    if (replaced) continue
    // 4) 删除 → 末尾补回
    missing.push(f)
  }
  let out = lines.join('\n')
  if (missing.length > 0) out = out ? `${out}\n${missing.join('\n')}` : missing.join('\n')
  return out
}
