/**
 * Chatbox Mod 模块 —— 冻结段保护（纯函数，无 JSX / 无外部依赖）
 *
 * 世界书/人物卡编辑页可「冻结选中文字」：冻结段存原文快照并带字段归属
 * （{field, text}），自动更新生成端被告知不得改写，应用端再做硬保护（原文回填）。
 * 兼容旧数据：纯 string 元素视为任意字段（V15 旧格式，仅存在于当时的冻结入口字段）。
 */

export interface FrozenSegment {
  field: string
  text: string
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

/**
 * 应用端硬保护（按字段 + 原文匹配，不记偏移）：
 * - AI 新内容中仍保留的该字段冻结段 → 原样保留（不剥离、不移动，避免位置漂移）
 * - 被 AI 改写或删除的冻结段 → 按冻结顺序原文回填到末尾
 * - 未冻结部分照常采用 AI 新内容；其它字段的冻结段不影响本字段
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
  const missing: string[] = []
  for (const f of mine) {
    if (t.indexOf(f) < 0) missing.push(f)
  }
  if (missing.length === 0) return t
  return t ? `${t}\n${missing.join('\n')}` : missing.join('\n')
}
