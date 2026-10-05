/**
 * Chatbox Mod 回归测试 —— 事件去重合并（event-dedup）
 * 覆盖：相似度计算、三档敏感度分类、合并规则（追加去重/关键词并集/上限/冻结）、planEventDedup 分流
 */
import {
  eventSimilarity,
  classifyDedup,
  planEventDedup,
  mergeEvent,
  canMerge,
  dedupDiffEvents,
  EVENT_SENSITIVITY,
} from '../src/renderer/modules/event-dedup.ts'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

// 1. 相似度：内容+关键词完全相同 = 1
check('相似:内容关键词全同=1', eventSimilarity('罗素在酒馆与赏金猎人发生冲突', ['罗素', '酒馆'], '罗素在酒馆与赏金猎人发生冲突', ['罗素', '酒馆']) === 1)

// 1b. 相似度：内容全同但无关键词 = 0.7（内容维度满分，已达跳过阈值）
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

// 4. 分类：标准档 0.7 跳过 / 0.4 疑似 / 0.3 新增
check('分类:0.75=skip', classifyDedup(0.75, 'standard') === 'skip')
check('分类:0.55=suspect', classifyDedup(0.55, 'standard') === 'suspect')
check('分类:0.35=add', classifyDedup(0.35, 'standard') === 'add')

// 5. 三档阈值可切换
check('分类:严格档0.65=suspect(0.8才skip)', classifyDedup(0.65, 'strict') === 'suspect')
check('分类:宽松档0.65=skip(0.6即skip)', classifyDedup(0.65, 'loose') === 'skip')
check('分类:宽松档0.35=suspect', classifyDedup(0.35, 'loose') === 'suspect')

// 6. planEventDedup：重复事件自动 skip
{
  const existing = [{ id: 'e1', content: '罗素在酒馆与赏金猎人发生冲突', keywords: ['罗素', '酒馆'] }]
  const newItems = [{ roleName: '罗素', content: '罗素在酒馆与赏金猎人发生冲突', keywords: ['罗素', '酒馆'] }]
  const r = planEventDedup(existing, newItems, 'standard')
  check('分流:完全相同→skip', r.skip.length === 1 && r.add.length === 0 && r.suspect.length === 0)
}

// 7. planEventDedup：无关事件正常 add
{
  const existing = [{ id: 'e1', content: '罗素在酒馆与赏金猎人发生冲突', keywords: ['酒馆'] }]
  const newItems = [{ roleName: '罗素', content: '帝洛曦在宫殿批阅奏折', keywords: ['宫殿'] }]
  const r = planEventDedup(existing, newItems, 'standard')
  check('分流:无关→add', r.add.length === 1 && r.skip.length === 0)
}

// 8. planEventDedup：疑似事件进 suspect（内容中等相似 + 关键词部分重合）
{
  const existing = [{ id: 'e1', content: '罗素在酒馆与赏金猎人发生冲突，双方拔剑对峙', keywords: ['罗素', '酒馆', '冲突'] }]
  const newItems = [{ roleName: '罗素', content: '罗素在酒馆外遇到赏金猎人，起了争执', keywords: ['罗素', '酒馆'] }]
  const r = planEventDedup(existing, newItems, 'standard')
  check('分流:微改写→suspect', r.suspect.length === 1 && r.add.length === 0)
  check('分流:suspect带分数', r.suspect[0].score >= 0.4 && r.suspect[0].score < 0.7)
}

// 9. mergeEvent：内容只增不覆盖、追加去重、关键词并集、时间戳更新
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

// 10. mergeEvent：冻结事件保留 frozen
{
  const old = { id: 'e9', roleName: '罗素', content: '冻结事件内容', keywords: [], frozen: true }
  const m = mergeEvent(old, { roleName: '罗素', content: '新细节', keywords: [] }, 100)
  check('合并:保留冻结标记', m.frozen === true)
}

// 11. canMerge：冻结事件不可合并
check('合并门槛:冻结不可合并', canMerge({ id: 'a', content: 'x', frozen: true }) === false)

// 12. canMerge：超 3000 字不可合并
{
  const long = '罗素'.repeat(1501)
  check('合并门槛:超长不可合并', canMerge({ id: 'b', content: long, keywords: [] }) === false)
}

// 13. planEventDedup：冻结目标是参照但不合并 → 相似时结果进 suspect（由用户定夺），
//     高相似也不自动 skip 的说明：skip 语义=不追加；冻结目标不影响 skip 判定
{
  const existing = [{ id: 'ef', content: '罗素在酒馆与赏金猎人发生冲突', keywords: ['罗素', '酒馆'], frozen: true }]
  const newItems = [{ roleName: '罗素', content: '罗素在酒馆与赏金猎人发生冲突', keywords: ['罗素', '酒馆'] }]
  const r = planEventDedup(existing, newItems, 'standard')
  check('分流:与冻结事件重复→skip(不追加)', r.skip.length === 1)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
// ---------- dedupDiffEvents（接入层） ----------
const cardOf = (name, events) => ({ name, associatedEvents: events })
const ccMap = (cards) => new Map(cards.map((c) => [c.name, c]))
const baseDiff = (items) => ({ wb: { add: [], update: [], remove: [] }, cc: { add: [], update: [], remove: [] }, events: { append: items } })

// 14. dedupDiffEvents：有预览 → 重复进 skip、疑似留 append 带 _dedup、新增保留
{
  const cards = [cardOf('罗素', [{ id: 'e1', content: '罗素在酒馆与赏金猎人发生冲突，双方拔剑对峙', keywords: ['罗素', '酒馆', '冲突'] }])]
  const diff = baseDiff([
    { roleName: '罗素', content: '罗素在酒馆与赏金猎人发生冲突，双方拔剑对峙', keywords: ['罗素', '酒馆', '冲突'] },   // 全同 → skip
    { roleName: '罗素', content: '罗素在酒馆外遇到赏金猎人，起了争执', keywords: ['罗素', '酒馆'] },                       // 微改 → suspect
    { roleName: '罗素', content: '帝洛曦在宫殿批阅奏折', keywords: ['宫殿'] },                                              // 无关 → add
  ])
  const r = dedupDiffEvents(diff, ccMap(cards), 'standard', true)
  check('接入:重复进skip', r.events.skip.length === 1)
  check('接入:suspect留append带_dedup', r.events.append.some((e) => e._dedup && typeof e._dedup.score === 'number'))
  check('接入:新增保留无标记', r.events.append.some((e) => !e._dedup && String(e.content) === '帝洛曦在宫殿批阅奏折'))
  check('接入:append仅剩2项(suspect+add)', r.events.append.length === 2)
}

// 15. dedupDiffEvents：自动模式（无预览）→ 疑似也保守跳过
{
  const cards = [cardOf('罗素', [{ id: 'e1', content: '罗素在酒馆与赏金猎人发生冲突，双方拔剑对峙', keywords: ['罗素', '酒馆', '冲突'] }])]
  const diff = baseDiff([
    { roleName: '罗素', content: '罗素在酒馆与赏金猎人发生冲突，双方拔剑对峙', keywords: ['罗素', '酒馆', '冲突'] },
    { roleName: '罗素', content: '罗素在酒馆外遇到赏金猎人，起了争执', keywords: ['罗素', '酒馆'] },
    { roleName: '罗素', content: '帝洛曦在宫殿批阅奏折', keywords: ['宫殿'] },
  ])
  const r = dedupDiffEvents(diff, ccMap(cards), 'standard', false)
  check('接入:自动模式skip=2条', r.events.skip.length === 2)
  check('接入:自动模式append=1条', r.events.append.length === 1)
}

// 16. dedupDiffEvents：无归属角色卡的事件原样保留
{
  const diff = baseDiff([{ roleName: '无名氏', content: '某处发生某事', keywords: ['某'] }])
  const r = dedupDiffEvents(diff, ccMap([]), 'standard', true)
  check('接入:无归属卡原样保留', r.events.append.length === 1 && r.events.skip.length === 0)
}

// 17. dedupDiffEvents：事件为空 → 原样返回
{
  const diff = baseDiff([])
  const r = dedupDiffEvents(diff, ccMap([]), 'standard', true)
  check('接入:空事件不报错', r.events.append.length === 0)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
