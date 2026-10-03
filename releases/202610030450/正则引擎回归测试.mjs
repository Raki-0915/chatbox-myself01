/* 阶段1 本地验证：真实 buildWorldBookSection/matchWorldBookEntry 用例 */
import { buildWorldBookSection } from '../src/renderer/modules/worldbook-match'

const entries = [
  // 关键词模式：只认"海洋"两个字
  { id: '1', name: '海洋', content: '海洋设定…', keywords: ['海洋'], triggerMode: 'keyword', enabled: true, order: 1 },
  // 正则模式：覆盖同义词/变体/英文
  { id: '2', name: '大海', content: '大海设定…', keywords: ['大海|海洋|ocean'], triggerMode: 'regex', enabled: true, order: 2 },
  // 正则：精确"长安"，不误触发单字"长"
  { id: '3', name: '长安', content: '长安城设定…', keywords: ["长安|長安|Chang'an"], triggerMode: 'regex', enabled: true, order: 3 },
  // 正则：时间跳跃数字模式（关键词永远做不到；支持中文数字）
  { id: '4', name: '时间跳跃', content: '时间穿越规则…', keywords: ['\\d+年后|过了\\s*\\d+\\s*年|[一二三四五六七八九十百]+年后'], triggerMode: 'regex', enabled: true, order: 4 },
  // always 必带
  { id: '5', name: '常驻设定', content: '世界基调…', keywords: [], triggerMode: 'always', enabled: true, order: 0 },
  // 非法正则：回退为空关键词 → 不触发
  { id: '6', name: '非法正则', content: '不应触发…', keywords: ['(['], triggerMode: 'regex', enabled: true, order: 6 },
  // 正则：火|火焰|fire，不含"烧"字
  { id: '7', name: '火系魔法', content: '火魔法…', keywords: ['火|火焰|fire'], triggerMode: 'regex', enabled: true, order: 5 },
]

function t(name, dialog, expectContains, expectNot) {
  const out = buildWorldBookSection(entries, dialog, 10000)
  const ok = expectContains.every((s) => out.includes(s)) && expectNot.every((s) => !out.includes(s))
  const hit = (out.split('\n').filter((l) => l.startsWith('### ')).join(', ') || '(仅常驻)')
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}\n  对话: ${dialog.slice(0, 36)}…\n  命中: ${hit}`)
  return ok
}

let all = true
// 关键词精确命中
all &&= t('关键词精确命中', '他跳进了海洋', ['海洋'], [])
// 关键词漏触发（"大海"不含"海洋"）→ 正则"大海"兜住
all &&= t('同义词兜底', '他看到了大海，海面平静', ['大海'], ['海洋'])
// 英文变体
all &&= t('英文变体', 'they sailed across the ocean', ['大海'], ['海洋'])
// 单字"长"不误触发"长安"
all &&= t('正则不误触发', '他站在城墙边，望向远方', ['常驻设定'], ['长安', '海洋', '大海'])
// 时间跳跃：五年后
all &&= t('时间跳跃命中', '五年后，他回到长安', ['长安', '时间跳跃'], [])
// 时间跳跃变体：过了 5 年
all &&= t('时间跳跃变体', '过了 5 年，一切都不一样了', ['时间跳跃'], [])
// always 必带
all &&= t('始终注入', '随便一句话', ['常驻设定'], [])
// 非法正则不触发
all &&= t('非法正则回退', '随便一句话', ['常驻设定'], ['非法正则'])
// "烧水"不命中"火"
all &&= t('火系不误触发', '他烧了一锅水', ['常驻设定'], ['火系魔法'])
// 火焰命中
all &&= t('火系命中', '他施展火焰魔法', ['火系魔法'], [])

console.log(all ? '\n== ALL PASS ==' : '\n== HAS FAIL ==')
process.exitCode = all ? 0 : 1
