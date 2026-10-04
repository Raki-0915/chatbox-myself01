/**
 * Chatbox Mod 回归测试 —— 冻结段保护（toggleFrozen / applyFrozenProtection）
 * 跑法：esbuild bundle 后 node 执行
 *   ./node_modules/.bin/esbuild scripts-verify/frozen-text.test.mjs --bundle --platform=node --format=esm --outfile=/tmp/fz-test.mjs && node /tmp/fz-test.mjs
 */
import { toggleFrozen, applyFrozenProtection } from '../src/renderer/modules/frozen-text'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

// 1. toggle：加入
{
  const r = toggleFrozen([], '四妹帝洛曦的宫殿位于西宫')
  check('toggle:加入', r.length === 1 && r[0].indexOf('四妹帝洛曦') !== -1)
}

// 2. toggle：再冻结一次 = 取消（移除）
{
  const f = '四妹帝洛曦的宫殿位于西宫'
  const once = toggleFrozen([], f)
  const twice = toggleFrozen(once, f)
  check('toggle:两次=取消', twice.length === 0)
}

// 3. toggle：多段互不影响，取消只移除目标段
{
  const a = '段A内容'
  const b = '段B内容'
  const l1 = toggleFrozen([], a)
  const l2 = toggleFrozen(l1, b)
  check('toggle:两段都在', l2.length === 2)
  const l3 = toggleFrozen(l2, a)
  check('toggle:取消A只留B', l3.length === 1 && l3[0] === b)
}

// 4. toggle：空白不冻结
{
  check('toggle:空白忽略', toggleFrozen([], '   ').length === 0)
}

// 5. applyFrozenProtection：AI 保留了冻结段 → 原样保留（位置不动）
{
  const frozen = ['四公主帝洛曦的宫殿内有偏殿用于议事']
  const aiNew = '东周女帝帝释天。四公主帝洛曦的宫殿内有偏殿用于议事。新增设定甲。'
  const r = applyFrozenProtection(aiNew, frozen)
  check('保护:保留段原样存在', r.indexOf(frozen[0]) !== -1)
  check('保护:新增内容照常', r.indexOf('新增设定甲') !== -1)
  check('保护:保留段位置不动(不重复回填)', r === aiNew)
}

// 6. applyFrozenProtection：AI 改写/删除冻结段 → 原文回填
{
  const frozen = ['四公主帝洛曦的宫殿内有偏殿用于议事']
  const aiNew = '东周女帝帝释天。四公主洛曦的宫殿很气派。'
  const r = applyFrozenProtection(aiNew, frozen)
  check('保护:被改写段原文回填', r.indexOf(frozen[0]) !== -1)
  check('保护:未冻结部分照常', r.indexOf('四公主洛曦的宫殿很气派') !== -1)
}

// 7. applyFrozenProtection：多个冻结段，仅回填缺失的
{
  const frozen = ['冻结甲', '冻结乙']
  const aiNew = '开头。冻结甲。结尾。'
  const r = applyFrozenProtection(aiNew, frozen)
  check('保护:保留的甲不动', r.indexOf('冻结甲') !== -1)
  check('保护:缺失的乙回填', r.indexOf('冻结乙') !== -1)
  check('保护:乙只出现一次', r.split('冻结乙').length - 1 === 1)
}

// 8. applyFrozenProtection：空冻结列表 → 原样返回
{
  const aiNew = '没有任何冻结，照常更新'
  check('保护:无冻结原样', applyFrozenProtection(aiNew, undefined) === aiNew)
  check('保护:空数组原样', applyFrozenProtection(aiNew, []) === aiNew)
}

// 9. applyFrozenProtection：AI 完全没动冻结段（原文未变）→ 结果与原文本一致
{
  const oldTxt = '甲段落。四公主帝洛曦的宫殿内有偏殿用于议事。乙段落。'
  const frozen = ['四公主帝洛曦的宫殿内有偏殿用于议事']
  const r = applyFrozenProtection(oldTxt, frozen)
  check('保护:未变动则完全一致', r === oldTxt)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
