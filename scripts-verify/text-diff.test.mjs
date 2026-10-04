/**
 * Chatbox Mod 回归测试 —— 词级 diff（diffText / buildChangePoints / summarizeChanges）
 * 跑法：esbuild bundle 后 node 执行
 *   ./node_modules/.bin/esbuild scripts-verify/text-diff.test.mjs --bundle --platform=node --format=esm --outfile=/tmp/td-test.mjs && node /tmp/td-test.mjs
 */
import { diffText, buildChangePoints, summarizeChanges, concatOps } from '../src/renderer/modules/text-diff'
import { isTrivialChange } from '../src/renderer/modules/text-similarity'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

// 1. 无改动 → 全部 equal，改动点 0，统计 0/0
{
  const ops = diffText('东周女帝帝释天，协助女帝处置朝政', '东周女帝帝释天，协助女帝处置朝政')
  const c = concatOps(ops)
  const pts = buildChangePoints(ops)
  const s = summarizeChanges(ops)
  check('无改动:delete空', c.delete === '')
  check('无改动:insert空', c.insert === '')
  check('无改动:equal非空', c.equal.length > 0)
  check('无改动:改动点0', pts.length === 0)
  check('无改动:统计0/0', s.del === 0 && s.ins === 0)
}

// 2. 纯新增（中间插入）→ 仅 insert，统计 +1
{
  const ops = diffText('东周女帝，处置朝政', '东周女帝帝释天的长女，处置朝政')
  const c = concatOps(ops)
  const s = summarizeChanges(ops)
  check('新增:insert含新词', c.insert.indexOf('帝释天的长女') !== -1)
  check('新增:delete空', c.delete === '')
  check('新增:统计+1', s.ins === 1 && s.del === 0)
  check('新增:摘要含新增', s.summary.indexOf('新增') !== -1)
}

// 3. 纯删除 → 仅 delete，统计 -1
{
  const ops = diffText('东周大公主，处置朝政', '东周，处置朝政')
  const c = concatOps(ops)
  const s = summarizeChanges(ops)
  check('删除:delete含被删词', c.delete.indexOf('大公主') !== -1)
  check('删除:insert空', c.insert === '')
  check('删除:统计-1', s.del === 1 && s.ins === 0)
  check('删除:摘要含删除', s.summary.indexOf('删除') !== -1)
}

// 4. 整体替换 → replace，统计 -1/+1，摘要含「改为」
{
  const ops = diffText('挡驾', '拦驾')
  const s = summarizeChanges(ops)
  check('替换:delete非空', concatOps(ops).delete.indexOf('挡') !== -1)
  check('替换:insert非空', concatOps(ops).insert.indexOf('拦') !== -1)
  check('替换:统计-1/+1', s.del === 1 && s.ins === 1)
  check('替换:摘要含改为', s.summary.indexOf('改为') !== -1)
}

// 5. 收尾改写（末尾新增）→ append
{
  const ops = diffText('东周女帝，处置朝政。', '东周女帝，处置朝政。每日辰时听政。')
  const pts = buildChangePoints(ops)
  const s = summarizeChanges(ops)
  const kinds = pts.map((p) => p.kind)
  check('收尾:含append', kinds[kinds.length - 1] === 'append')
  check('收尾:统计+1', s.ins === 1 && s.del === 0)
  check('收尾:摘要含收尾', s.summary.indexOf('收尾改写') !== -1)
}

// 6. 混合多处改动 → 统计 -2/+3（两处替换 + 一处收尾新增）
{
  const oldTxt = '大公主挡驾，协助女帝。'
  const newTxt = '长公主拦驾，协助女帝处置朝政。'
  const ops = diffText(oldTxt, newTxt)
  const pts = buildChangePoints(ops)
  const s = summarizeChanges(ops)
  check('混合:至少2个改动点', pts.length >= 2)
  check('混合:统计-2/+3', s.del === 2 && s.ins === 3)
}

// 7. 中文标点切分不把整句当碎片；替换统计与内容一致
{
  const oldTxt = '姓名：帝羽微。身份：大公主。'
  const newTxt = '姓名：帝羽微。身份：长公主。'
  const pts = buildChangePoints(diffText(oldTxt, newTxt))
  check('标点:改动点数≥1', pts.length >= 1)
  const s = summarizeChanges(diffText(oldTxt, newTxt))
  check('标点:替换删增相等', s.del === s.ins && s.ins >= 1)
}

// 8. 空输入安全
{
  const ops = diffText('', '')
  const c = concatOps(ops)
  check('空:ops为空', c.equal === '' && c.delete === '' && c.insert === '')
  check('空:改动点0', buildChangePoints(ops).length === 0)
}

// 9. 轻微改动联动：相似度高 → isTrivialChange=true，但 diff 仍有删增（可高亮）
{
  const oldTxt = '关键地点：- 京师：东周首都，皇宫所在地 - 西宫：四公主帝洛曦的宫殿，内有偏殿用于议事 - 东宫：大公主帝羽微的宫殿，内有书房用于议事和私会，并有暖阁'
  const tweakNew = '关键地点：- 京师：东周王朝首都，皇宫所在地。 - 西宫：四公主帝洛曦的宫殿，内有偏殿用于议事 - 东宫：大公主帝羽微的宫殿，内有书房用于议事和私会，并有暖阁'
  const ops = diffText(oldTxt, tweakNew)
  const c = concatOps(ops)
  check('轻微:相似度高判定true', isTrivialChange(oldTxt, tweakNew) === true)
  check('轻微:diff仍有改动(可高亮)', c.delete.length > 0 || c.insert.length > 0)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
