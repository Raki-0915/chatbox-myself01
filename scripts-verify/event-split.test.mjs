/**
 * Chatbox Mod 回归测试 —— 背景/事件分流（event-split）
 * 覆盖：remove 保护、事件追加累积/截断、关键词触发注入
 */
import { applyRemoveGuard, appendEvents, buildAssociatedEventSection, capEvents, MAX_EVENTS_PER_CARD } from '../src/renderer/modules/event-split'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

const baseCard = () => ({
  id: 'c1', name: '龙辰', age: '20', gender: '男', occupation: '', appearance: '', height: '', weight: '',
  distinguishingFeatures: '', personalityType: '', strengths: '', weaknesses: '', hobbies: '',
  backgroundStory: '身世背景', relationships: [], customAttributes: [], characterBook: [], enabled: true,
  createdAt: 0, updatedAt: 0, versionHistory: [],
})

const mkDiff = (extra = {}) => ({
  wb: { add: [], update: [], remove: ['旧世界书'] },
  cc: { add: [], update: [], remove: ['旧人物卡'] },
  events: { append: [] },
  ...extra,
})

async function main() {
  // ---- remove 保护 ----
  {
    const d = mkDiff()
    const out = applyRemoveGuard(
      d,
      (n) => n === '旧世界书',            // 世界书：含冻结段 → 保护
      (n) => n === '旧人物卡'              // 人物卡：含冻结段或事件 → 保护
    )
    check('remove保护:冻结段世界书禁止删除', out.wb.remove.length === 0)
    check('remove保护:有事件人物卡禁止删除', out.cc.remove.length === 0)
  }
  {
    const d = mkDiff({ wb: { add: [], update: [], remove: ['普通书', '冻结书'] }, cc: { add: [], update: [], remove: [] } })
    const out = applyRemoveGuard(d, (n) => n === '冻结书', () => false)
    check('remove保护:普通条目仍可删', out.wb.remove.length === 1 && out.wb.remove[0] === '普通书')
  }

  // ---- 事件追加：累积不覆盖、末尾追加 ----
  {
    let card = baseCard()
    card = appendEvents(card, [{ roleName: '龙辰', content: '寝殿独处', keywords: ['龙辰'] }], 1000)
    card = appendEvents(card, [{ roleName: '龙辰', content: '配合默契', keywords: ['默契'] }], 2000)
    check('事件追加:两条都到末尾且有序', card.associatedEvents.length === 2 && card.associatedEvents[0].content === '寝殿独处' && card.associatedEvents[1].content === '配合默契')
    check('事件追加:带时间戳与关键词', card.associatedEvents[0].t === 1000 && card.associatedEvents[0].keywords[0] === '龙辰')
  }
  {
    let card = baseCard()
    const old = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, roleName: '龙辰', content: `旧事件${i}`, keywords: [], t: i }))
    card = { ...card, associatedEvents: old }
    card = appendEvents(card, [{ roleName: '龙辰', content: '新事件', keywords: [] }], 9999)
    check('事件追加:追加在旧事件之后', card.associatedEvents[card.associatedEvents.length - 1].content === '新事件')
  }
  {
    let card = baseCard()
    card = appendEvents(card, [{ roleName: '别人', content: '不属于本卡', keywords: [] }])
    check('事件追加:归属角色不符则跳过', (card.associatedEvents ?? []).length === 0)
    card = appendEvents(card, [{ roleName: '龙辰', content: '   ', keywords: [] }])
    check('事件追加:空内容跳过', (card.associatedEvents ?? []).length === 0)
  }
  {
    let card = baseCard()
    const old = Array.from({ length: MAX_EVENTS_PER_CARD + 10 }, (_, i) => ({ id: `e${i}`, roleName: '龙辰', content: `事件${i}`, keywords: [], t: i }))
    card = { ...card, associatedEvents: old }
    const capped = capEvents(card.associatedEvents)
    check('事件上限:超出截断最旧', capped.length === MAX_EVENTS_PER_CARD && capped[0].content === '事件10')
    card = appendEvents(card, [{ roleName: '龙辰', content: '最新', keywords: [] }], 9999)
    check('事件上限:追加后仍截断且保留最新', card.associatedEvents.length === MAX_EVENTS_PER_CARD && card.associatedEvents[card.associatedEvents.length - 1].content === '最新')
  }

  // ---- 关键词触发注入 ----
  {
    const card = { ...baseCard(), associatedEvents: [
      { id: 'a', roleName: '龙辰', content: '与龙辰配合默契', keywords: ['默契'], t: 1 },
      { id: 'b', roleName: '龙辰', content: '寝殿独处', keywords: ['寝殿'], t: 2 },
      { id: 'c', roleName: '龙辰', content: '无关键词事件不常驻', keywords: [], t: 3 },
      { id: 'd', roleName: '龙辰', content: '冻结事件也注入', keywords: ['默契'], t: 4, frozen: true },
    ] }
    const s = buildAssociatedEventSection([card], '今天他们配合很默契', 2000)
    check('事件注入:命中关键词才注入', s.includes('配合默契') && !s.includes('无关键词事件不常驻'))
    check('事件注入:未命中不注入', !s.includes('寝殿独处'))
    check('事件注入:冻结事件仍注入', s.includes('冻结事件也注入'))
    check('事件注入:带触发词标注', s.includes('触发词: 默契'))
  }
  {
    const card = { ...baseCard(), associatedEvents: [{ id: 'a', roleName: '龙辰', content: '事件A', keywords: ['甲'], t: 1 }] }
    const s = buildAssociatedEventSection([card], '完全没有关键词', 2000)
    check('事件注入:无命中返回空', s === '')
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

void main()
