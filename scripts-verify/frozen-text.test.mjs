/**
 * Chatbox Mod 回归测试 —— 冻结段保护（toggleFrozen / applyFrozenProtection，按字段归属）
 * 跑法：esbuild bundle 后 node 执行
 */
import { toggleFrozen, applyFrozenProtection } from '../src/renderer/modules/frozen-text'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

// 1. toggle：加入（带字段归属）
{
  const r = toggleFrozen([], 'content', '四妹帝洛曦的宫殿位于西宫')
  check('toggle:加入带字段', r.length === 1 && r[0].field === 'content' && r[0].text.indexOf('四妹帝洛曦') !== -1)
}

// 2. toggle：再冻结一次 = 取消（移除）
{
  const f = '四妹帝洛曦的宫殿位于西宫'
  const once = toggleFrozen([], 'content', f)
  const twice = toggleFrozen(once, 'content', f)
  check('toggle:两次=取消', twice.length === 0)
}

// 3. toggle：不同字段的段互不影响，取消只移除同字段目标段
{
  const a = '外貌段内容'
  const b = '性格段内容'
  const l1 = toggleFrozen([], 'appearance', a)
  const l2 = toggleFrozen(l1, 'personalityType', b)
  check('toggle:两个字段各一段', l2.length === 2)
  const l3 = toggleFrozen(l2, 'appearance', a)
  check('toggle:取消外貌段只留性格段', l3.length === 1 && l3[0].field === 'personalityType')
}

// 4. toggle：空白不冻结
{
  check('toggle:空白忽略', toggleFrozen([], 'content', '   ').length === 0)
}

// 5. 兼容旧数据：纯 string 元素按给定字段归属
{
  const legacy = ['旧格式冻结段甲', '旧格式冻结段乙']
  const r = toggleFrozen(legacy, 'content', '新段')
  check('toggle:旧string+新段共存', r.length === 3 && r.filter((x) => x.field === 'content').length === 3)
  const mine = r.filter((x) => x.field === 'content' && x.text === '旧格式冻结段甲')
  check('toggle:旧string归属到字段', mine.length === 1)
}

// 6. applyFrozenProtection：AI 保留了冻结段 → 原样保留（位置不动）
{
  const frozen = [{ field: 'backgroundStory', text: '四公主帝洛曦的宫殿内有偏殿用于议事' }]
  const aiNew = '东周女帝帝释天。四公主帝洛曦的宫殿内有偏殿用于议事。新增设定甲。'
  const r = applyFrozenProtection(aiNew, frozen, 'backgroundStory')
  check('保护:保留段原样存在', r.indexOf(frozen[0].text) !== -1)
  check('保护:新增内容照常', r.indexOf('新增设定甲') !== -1)
  check('保护:保留段位置不动(不重复回填)', r === aiNew)
}

// 7. applyFrozenProtection：AI 改写/删除冻结段 → 原文回填
{
  const frozen = [{ field: 'backgroundStory', text: '四公主帝洛曦的宫殿内有偏殿用于议事' }]
  const aiNew = '东周女帝帝释天。四公主洛曦的宫殿很气派。'
  const r = applyFrozenProtection(aiNew, frozen, 'backgroundStory')
  check('保护:被改写段原文回填', r.indexOf(frozen[0].text) !== -1)
  check('保护:未冻结部分照常', r.indexOf('四公主洛曦的宫殿很气派') !== -1)
}

// 8. applyFrozenProtection：多个冻结段，仅回填缺失的
{
  const frozen = [{ field: 'backgroundStory', text: '冻结甲' }, { field: 'backgroundStory', text: '冻结乙' }]
  const aiNew = '开头。冻结甲。结尾。'
  const r = applyFrozenProtection(aiNew, frozen, 'backgroundStory')
  check('保护:保留的甲不动', r.indexOf('冻结甲') !== -1)
  check('保护:缺失的乙回填', r.indexOf('冻结乙') !== -1)
  check('保护:乙只出现一次', r.split('冻结乙').length - 1 === 1)
}

// 9. applyFrozenProtection：字段隔离 —— 其它字段的冻结段不影响本字段
{
  const frozen = [
    { field: 'appearance', text: '瓜子脸肤若凝脂' },
    { field: 'backgroundStory', text: '四公主帝洛曦的宫殿内有偏殿用于议事' },
  ]
  const aiNew = '东周女帝帝释天。四公主洛曦的宫殿很气派。瓜子脸肤若凝脂。'
  const r = applyFrozenProtection(aiNew, frozen, 'backgroundStory')
  check('保护:背景故事回填(被AI改写)', r.indexOf('四公主帝洛曦的宫殿内有偏殿用于议事') !== -1)
  check('保护:外貌段不影响背景故事回填', r.split('四公主帝洛曦的宫殿内有偏殿用于议事').length - 1 === 1)
  const r2 = applyFrozenProtection(aiNew, frozen, 'appearance')
  check('保护:外貌字段不匹配背景故事段', r2 === aiNew)
}

// 10. applyFrozenProtection：空冻结列表 → 原样返回
{
  const aiNew = '没有任何冻结，照常更新'
  check('保护:undefined原样', applyFrozenProtection(aiNew, undefined, 'content') === aiNew)
  check('保护:空数组原样', applyFrozenProtection(aiNew, [], 'content') === aiNew)
}

// 11. applyFrozenProtection：AI 完全没动冻结段（原文未变）→ 结果与原文本一致
{
  const oldTxt = '甲段落。四公主帝洛曦的宫殿内有偏殿用于议事。乙段落。'
  const frozen = [{ field: 'content', text: '四公主帝洛曦的宫殿内有偏殿用于议事' }]
  check('保护:未变动则完全一致', applyFrozenProtection(oldTxt, frozen, 'content') === oldTxt)
}

// 12. applyFrozenProtection：兼容旧 string 冻结数据（无字段 → 按传入字段匹配）
{
  const legacy = ['旧冻结段一']
  const aiNew = '新内容把旧冻结段一改掉了。'
  const r = applyFrozenProtection(aiNew, legacy, 'backgroundStory')
  check('保护:旧string冻结段回填', r.indexOf('旧冻结段一') !== -1)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
