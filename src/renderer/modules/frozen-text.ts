/**
 * Chatbox Mod 模块 —— 冻结段保护（纯函数，无 JSX / 无外部依赖）
 *
 * 世界书/人物卡编辑页可「冻结选中文字」：冻结段存原文快照（frozenTexts），
 * 自动更新生成端被告知不得改写，应用端再做硬保护（原文回填）。
 */

/**
 * toggle 冻结：选中文本若已在冻结列表则移除（取消冻结），否则加入。
 * 空/空白文本不冻结。
 */
export function toggleFrozen(frozenTexts: string[], selection: string): string[] {
  const t = selection.trim()
  if (!t) return Array.isArray(frozenTexts) ? [...frozenTexts] : []
  const list = Array.isArray(frozenTexts) ? [...frozenTexts] : []
  const idx = list.findIndex((f) => f.trim() === t)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(t)
  return list
}

/**
 * 应用端硬保护（按原文匹配，不记偏移）：
 * - AI 新内容中仍保留的冻结段 → 原样保留（不剥离、不移动，避免位置漂移）
 * - 被 AI 改写或删除的冻结段 → 按冻结顺序原文回填到末尾
 * - 未冻结部分照常采用 AI 新内容
 */
export function applyFrozenProtection(newText: string, frozenTexts: string[] | undefined): string {
  const list = (Array.isArray(frozenTexts) ? frozenTexts : []).map((f) => f.trim()).filter(Boolean)
  if (list.length === 0) return newText
  const t = String(newText ?? '')
  const missing: string[] = []
  for (const f of list) {
    if (t.indexOf(f) < 0) missing.push(f)
  }
  if (missing.length === 0) return t
  return t ? `${t}\n${missing.join('\n')}` : missing.join('\n')
}
