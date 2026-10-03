/**
 * Chatbox Mod 回归测试 —— 自动更新「轻微改动」判定（isTrivialChange / similarityRatio）
 * 跑法：esbuild bundle 后 node 执行
 *   ./node_modules/.bin/esbuild scripts-verify/similarity.test.mjs --bundle --platform=node --format=esm --outfile=/tmp/sim-test.mjs && node /tmp/sim-test.mjs
 */
import { isTrivialChange, similarityRatio, SIMILARITY_TRIVIAL } from '../src/renderer/modules/text-similarity'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

// 1. 完全相同 → 1
check('完全相同=1', similarityRatio('关键地点：- 京师：东周首都', '关键地点：- 京师：东周首都') === 1)
// 2. 空白/换行差异 → 1（归一化后相同）
check('空白差异=1', similarityRatio('关键地点：- 京师\n- 西宫', '关键地点：- 京师 - 西宫') === 1)
// 3. 完全不同 → 0
check('完全不同=0', similarityRatio('abcdef', 'xyz') === 0)

// 4. 仅措辞微调（无新信息）→ 轻微改动（默认不勾选，可手动应用）
const oldTxt = '关键地点：- 京师：东周首都，皇宫所在地 - 西宫：四公主帝洛曦的宫殿，内有偏殿用于议事 - 东宫：大公主帝羽微的宫殿，内有书房用于议事和私会，并有暖阁'
const tweakNew = '关键地点：- 京师：东周王朝首都，皇宫所在地。 - 西宫：四公主帝洛曦的宫殿，内有偏殿用于议事 - 东宫：大公主帝羽微的宫殿，内有书房用于议事和私会，并有暖阁'
check('措辞微调=轻微改动', isTrivialChange(oldTxt, tweakNew) === true)

// 5. 追加一句真实新地点（长度明显增长）→ 非轻微，正常勾选展示
const addNew = oldTxt + ' - 凤鸣宫：女帝帝释天在皇宫内的寝宫。殿内常燃安神香，陈设奢华，设有软榻'
check('追加新地点=非轻微', isTrivialChange(oldTxt, addNew) === false)

// 6. 实质性大改 → 非轻微
const bigOld = '关键地点：- 京师：东周首都，皇宫所在地'
const bigNew = '关键地点已全部废弃，改为：- 沧澜城：灵气复苏后新建的都城 - 蛮荒妖域：人类禁区'
check('实质大改<阈值', similarityRatio(bigOld, bigNew) < SIMILARITY_TRIVIAL)
check('实质大改=非轻微', isTrivialChange(bigOld, bigNew) === false)

// 7. 空内容边界
check('双空=1', similarityRatio('', '') === 1)
check('单空=0', similarityRatio('', 'abc') === 0)
check('空=非轻微', isTrivialChange('', '内容') === false)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
