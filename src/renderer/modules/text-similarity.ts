/**
 * Chatbox Mod 模块 —— 文本相似度（纯函数，无任何依赖）
 *
 * 用于自动更新：识别「无实质变化」的重复 update——模型每次几乎都会重写综合条目，
 * 若新旧内容高度相似则视为「仅轻微改动」，在更新预览中默认不勾选（用户可手动应用）。
 */

/** 文本相似度阈值：新旧内容相似度 ≥ 此值判定为「仅轻微改动」（措辞微调/换行/顺序等无实质信息变化） */
export const SIMILARITY_TRIVIAL = 0.92

/**
 * 判定「仅轻微改动」：新旧内容高度相似（≥ SIMILARITY_TRIVIAL）且长度没有明显增长。
 * 增长超过旧长度 15% 或绝对 60 字 → 视为有实质新增内容，不算轻微（正常勾选展示）。
 */
export function isTrivialChange(oldTxt: string, newTxt: string): boolean {
  if (!oldTxt || !newTxt) return false
  if (similarityRatio(oldTxt, newTxt) < SIMILARITY_TRIVIAL) return false
  const norm = (s: string) => s.replace(/\s+/g, '')
  const oldLen = norm(oldTxt).length
  const grow = norm(newTxt).length - oldLen
  if (grow > 0.15 * oldLen || grow > 60) return false
  return true
}

/**
 * 文本相似度（字符 bigram Dice 系数，0~1）。
 * 归一化：去空白、小写。完全相同返回 1，完全无交集返回 0。
 */
export function similarityRatio(a: string, b: string): number {
  const norm = (s: string) => s.replace(/\s+/g, '').trim().toLowerCase()
  const x = norm(a)
  const y = norm(b)
  if (!x && !y) return 1
  if (!x || !y) return 0
  const grams = (s: string): Set<string> => {
    const g = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2))
    return g
  }
  const gx = grams(x)
  const gy = grams(y)
  let inter = 0
  for (const gg of gx) if (gy.has(gg)) inter++
  const denom = gx.size + gy.size
  return denom === 0 ? 0 : (2 * inter) / denom
}
