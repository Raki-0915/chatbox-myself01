/**
 * Chatbox Mod 模块 —— 词级文本 diff（纯函数，无 JSX / 无外部依赖）
 *
 * 供「更新预览」使用：把旧内容与新内容做词级差分，产出
 *   - DiffOp[]：equal / delete / insert 三段序列（用于渲染高亮）
 *   - ChangePoint[]：合并后的改动点（替换/新增/删除/收尾）
 *   - 摘要 + 增减统计（-N / +M）
 */

export type DiffOp = { type: 'equal' | 'delete' | 'insert'; text: string }

export type ChangeKind = 'replace' | 'insert' | 'delete' | 'append'

export type ChangePoint = {
  kind: ChangeKind
  /** 改动点涉及旧文本（删除/替换部分），新增无旧文本时为空 */
  oldText: string
  /** 改动点涉及新文本（新增/替换部分），删除无新文本时为空 */
  newText: string
}

export type DiffSummary = {
  /** 一句话改点摘要，如「身份改述 · 新增"…" · 删除"…" · 收尾改写」 */
  summary: string
  /** 删除改动点数量（delete + replace） */
  del: number
  /** 新增改动点数量（insert + replace + append） */
  ins: number
}

const CJK_RE = /[\u4e00-\u9fff]/
// 中文字一个 token；英文单词/数字一个 token；连续标点+空白一个 token
const TOKEN_RE = /[\u4e00-\u9fff]|[A-Za-z0-9]+|[^\u4e00-\u9fffA-Za-z0-9]+/g

/** 中文按字 + 英文按词 + 标点空白成段的 token 序列 */
function tokenize(s: string): string[] {
  const m = s.match(TOKEN_RE)
  return m ?? []
}

/**
 * LCS 差分：输入旧/新 token 序列，返回合并相邻同类后的 ops。
 * 先消除公共前后缀（中文重复字场景下避免跨段误配），再对中间剩余段做 LCS。
 * 复杂度 O(n*m)，条目文本一般 <2KB，开销可忽略。
 */
function diffTokens(oldTokens: string[], newTokens: string[]): DiffOp[] {
  const n0 = oldTokens.length
  const m0 = newTokens.length
  // 公共前缀
  let s = 0
  while (s < n0 && s < m0 && oldTokens[s] === newTokens[s]) s++
  // 公共后缀
  let e1 = n0
  let e2 = m0
  while (e1 > s && e2 > s && oldTokens[e1 - 1] === newTokens[e2 - 1]) {
    e1--
    e2--
  }
  const raw: DiffOp[] = []
  for (let k = 0; k < s; k++) raw.push({ type: 'equal', text: oldTokens[k] })

  const midOld = oldTokens.slice(s, e1)
  const midNew = newTokens.slice(s, e2)
  if (midOld.length > 0 || midNew.length > 0) {
    const n = midOld.length
    const m = midNew.length
    // dp[i][j] = midOld[0..i) 与 midNew[0..j) 的 LCS 长度
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] =
          midOld[i - 1] === midNew[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
    // 回溯（逆序）
    const rev: DiffOp[] = []
    let i = n
    let j = m
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
        rev.push({ type: 'equal', text: midOld[i - 1] })
        i--
        j--
      } else if (i > 0 && dp[i][j] === dp[i - 1][j]) {
        rev.push({ type: 'delete', text: midOld[i - 1] })
        i--
      } else {
        rev.push({ type: 'insert', text: midNew[j - 1] })
        j--
      }
    }
    for (let k = rev.length - 1; k >= 0; k--) raw.push(rev[k])
  }

  for (let k = e1; k < n0; k++) raw.push({ type: 'equal', text: oldTokens[k] })

  // 合并相邻同类
  const merged: DiffOp[] = []
  for (const op of raw) {
    const last = merged[merged.length - 1]
    if (last && last.type === op.type) last.text += op.text
    else merged.push({ type: op.type, text: op.text })
  }
  return merged
}

/** 入口：旧文本、新文本 → 词级 diff ops */
export function diffText(oldText: string, newText: string): DiffOp[] {
  return diffTokens(tokenize(oldText ?? ''), tokenize(newText ?? ''))
}

/**
 * 把 ops 合并为人类可读的改动点：
 * 相邻 delete/insert 段（含中间 ≤2 token 的短 equal 上下文）合并为一个改动点；
 * 同时含删与增 → replace；仅增 → insert；仅删 → delete。
 * 注：渲染高亮仍用原始 ops（字符级精确），此处仅用于摘要与统计，避免中文重复字碎片化。
 */
export function buildChangePoints(ops: DiffOp[]): ChangePoint[] {
  const points: ChangePoint[] = []
  let cur: { old: string; new: string; sawDel: boolean; sawIns: boolean } | null = null
  let gapTokens = 0
  const flush = () => {
    if (!cur) return
    const kind: ChangeKind = cur.sawDel && cur.sawIns ? 'replace' : cur.sawIns ? 'insert' : 'delete'
    points.push({ kind, oldText: cur.old, newText: cur.new })
    cur = null
    gapTokens = 0
  }
  const isPunct = (s: string) => !/[\u4e00-\u9fffA-Za-z0-9]/.test(s)
  for (const op of ops) {
    if (op.type === 'equal') {
      if (cur) {
        // 仅标点/空白的短 equal 可并入改动点；中文/数字实词强制分隔（避免跨词误并）
        if (isPunct(op.text)) gapTokens += op.text.length
        else flush()
      }
      continue
    }
    if (cur && gapTokens > 2) flush()
    if (!cur) cur = { old: '', new: '', sawDel: false, sawIns: false }
    gapTokens = 0
    if (op.type === 'delete') {
      cur.old += op.text
      cur.sawDel = true
    } else {
      cur.new += op.text
      cur.sawIns = true
    }
  }
  flush()
  // 收尾：最后一个改动点是纯新增、位于文本末尾（其后仅标点/空白）、且前有中文正文（非整段重写）→ 收尾改写
  const last = points[points.length - 1]
  if (last && last.kind === 'insert' && isAppendTail(ops) && ops.some((o) => o.type === 'equal' && !isPunct(o.text))) {
    last.kind = 'append'
  }
  return points
}

const isPunctStr = (s: string) => !/[\u4e00-\u9fffA-Za-z0-9]/.test(s)

/** 判定 ops 的最后一个 insert 是否位于文本末尾（其后仅标点/空白） */
function isAppendTail(ops: DiffOp[]): boolean {
  // new 侧序列（equal + insert），从尾部往回找第一个 insert
  for (let k = ops.length - 1; k >= 0; k--) {
    const o = ops[k]
    if (o.type === 'delete') continue
    if (o.type === 'insert') return true
    // equal：若含中文/数字实词，说明 insert 之后还有正文 → 非末尾
    if (!isPunctStr(o.text)) return false
  }
  return false
}

const QUOTE = (s: string) => s.trim()

/** 截断用于摘要引用 */
function brief(s: string, n = 10): string {
  const t = s.trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** 生成一句话摘要 + 增减统计 */
export function summarizeChanges(ops: DiffOp[]): DiffSummary {
  const points = buildChangePoints(ops)
  const parts: string[] = []
  let del = 0
  let ins = 0
  for (const p of points) {
    switch (p.kind) {
      case 'replace':
        del++
        ins++
        if (p.oldText.trim().length <= 12 && p.newText.trim().length <= 12) {
          parts.push(`「${brief(p.oldText)}」改为「${brief(p.newText)}」`)
        } else {
          parts.push('改写')
        }
        break
      case 'insert':
        ins++
        parts.push(`新增"${brief(p.newText)}"`)
        break
      case 'delete':
        del++
        parts.push(`删除"${brief(p.oldText)}"`)
        break
      case 'append':
        ins++
        parts.push('收尾改写')
        break
    }
  }
  return {
    summary: parts.length ? parts.join(' · ') : '（无实质改动）',
    del,
    ins,
  }
}

/** 渲染辅助：旧文本展示（delete → 删除线），新文本展示（insert → 下划线） */
export function renderOldOps(ops: DiffOp[]): string {
  return ops
    .filter((o) => o.type !== 'insert')
    .map((o) => (o.type === 'delete' ? `\u0336${o.text}\u0336` : o.text))
    .join('')
}

/** 供 UI 逐段渲染（返回带标记的段落），避免纯字符串丢样式 */
export type TaggedSegment = { text: string; kind: 'normal' | 'del' | 'ins' }

export function segmentForNew(ops: DiffOp[]): TaggedSegment[] {
  return ops
    .filter((o) => o.type !== 'delete')
    .map((o) => ({ text: o.text, kind: o.type === 'insert' ? 'ins' : 'normal' } as TaggedSegment))
}

export function segmentForOld(ops: DiffOp[]): TaggedSegment[] {
  return ops
    .filter((o) => o.type !== 'insert')
    .map((o) => ({ text: o.text, kind: o.type === 'delete' ? 'del' : 'normal' } as TaggedSegment))
}

/** 供测试断言：是否含连续「X」片段 */
export function concatOps(ops: DiffOp[]): { equal: string; delete: string; insert: string } {
  return ops.reduce(
    (acc, o) => {
      acc[o.type] += o.text
      return acc
    },
    { equal: '', delete: '', insert: '' }
  )
}
