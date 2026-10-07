/**
 * Chatbox Mod 回归测试 —— 事件合并能力（event-dedup，v2.2）
 * v2.2 覆盖：相似度计算、合并规则（追加去重/关键词并集/上限/冻结）、canMerge 门槛、mergeEvents 多源合并
 * （自动判重已移除：不再有敏感度三档 / classify / plan / dedupDiffEvents）
 */
import {
  eventSimilarity,
  mergeEvent,
  mergeEvents,
  canMerge,
  EVENT_MERGE_LIMIT,
} from '../src/renderer/modules/event-dedup.ts'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

// 1. 相似度：内容+关键词完全相同 = 1
check('相似:内容关键词全同=1', eventSimilarity('罗素在酒馆与赏金猎人发生冲突', ['罗素', '酒馆'], '罗素在酒馆与赏金猎人发生冲突', ['罗素', '酒馆']) === 1)

// 1b. 相似度：内容全同但无关键词 = 0.7（内容维度满分）
{
  const s = eventSimilarity('罗素在酒馆与赏金猎人发生冲突', [], '罗素在酒馆与赏金猎人发生冲突', [])
  check('相似:内容全同无关键词=0.7', s === 0.7)
}

// 2. 相似度：无关内容 = 低分
{
  const s = eventSimilarity('罗素在酒馆与赏金猎人发生冲突', [], '帝洛曦在宫殿批阅奏折，北境入冬', [])
  check('相似:无关内容低分', s < 0.4)
}

// 3. 相似度：关键词重合拉高分
{
  const s1 = eventSimilarity('罗素在酒馆与赏金猎人发生冲突', ['罗素', '酒馆'], '罗素与赏金猎人在酒馆起了争执', ['罗素', '酒馆'])
  const s2 = eventSimilarity('罗素在酒馆与赏金猎人发生冲突', [], '罗素与赏金猎人在酒馆起了争执', [])
  check('相似:关键词重合提升分数', s1 > s2)
}

// 4. mergeEvent：内容只增不覆盖、追加去重、关键词并集、时间戳更新
{
  const old = { id: 'e1', roleName: '罗素', content: '罗素在酒馆与赏金猎人发生冲突', keywords: ['罗素'], t: 1000 }
  const m = mergeEvent(old, { roleName: '罗素', content: '酒馆内桌椅掀翻一片', keywords: ['酒馆', '罗素'] }, 2000)
  check('合并:内容追加', m.content === '罗素在酒馆与赏金猎人发生冲突\n酒馆内桌椅掀翻一片')
  check('合并:关键词并集去重', m.keywords.join(',') === '罗素,酒馆')
  check('合并:时间戳更新', m.t === 2000)
  check('合并:保留原id', m.id === 'e1')
  const dup = mergeEvent(old, { roleName: '罗素', content: '罗素在酒馆与赏金猎人发生冲突', keywords: [] }, 3000)
  check('合并:已包含内容不重复追加', dup.content === old.content)
}

// 5. mergeEvents：多源合并（按序拼接、重复句子只保留一次、触发词并集上限 8）
{
  const old = { id: 'e1', roleName: '罗素', content: '罗素在酒馆与赏金猎人发生冲突', keywords: ['罗素'], t: 1000 }
  const m = mergeEvents(
    old,
    [
      { roleName: '罗素', content: '酒馆内桌椅掀翻一片', keywords: ['酒馆'] },
      { roleName: '罗素', content: '罗素在酒馆与赏金猎人发生冲突', keywords: ['罗素', '冲突'] }, // 重复 → 去重
      { roleName: '罗素', content: '罗素提剑追出酒馆', keywords: ['罗素', '剑'] },
    ],
    3000
  )
  check('多源合并:内容按序拼接且去重', m.content === '罗素在酒馆与赏金猎人发生冲突\n酒馆内桌椅掀翻一片\n罗素提剑追出酒馆')
  check('多源合并:关键词并集去重', m.keywords.join(',') === '罗素,酒馆,冲突,剑')
  check('多源合并:时间戳取最近', m.t === 3000)
  check('多源合并:保留原id', m.id === 'e1')
}

// 6. mergeEvents：触发词并集超 8 个截断
{
  const old = { id: 'e2', roleName: '罗素', content: 'A', keywords: ['k1', 'k2', 'k3'] }
  const m = mergeEvents(old, [{ roleName: '罗素', content: 'B', keywords: ['k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10'] }], 1)
  check('多源合并:触发词上限8', m.keywords.length === 8)
}

// 7. mergeEvent：冻结事件保留 frozen
{
  const old = { id: 'e9', roleName: '罗素', content: '冻结事件内容', keywords: [], frozen: true }
  const m = mergeEvent(old, { roleName: '罗素', content: '新细节', keywords: [] }, 100)
  check('合并:保留冻结标记', m.frozen === true)
}

// 8. canMerge：冻结事件不可合并
check('合并门槛:冻结不可合并', canMerge({ id: 'a', content: 'x', frozen: true }) === false)

// 9. canMerge：超上限不可合并
{
  const long = '罗素'.repeat(1501)
  check('合并门槛:超长不可合并', canMerge({ id: 'b', content: long, keywords: [] }) === false)
  check('合并门槛:恰好上限可合并', canMerge({ id: 'c', content: '罗素'.repeat(EVENT_MERGE_LIMIT / 2), keywords: [] }) === true)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
