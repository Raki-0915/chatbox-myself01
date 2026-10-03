/**
 * 回归测试：世界书标准格式导入 / 注入体积自适应 / %keywords% 递归引用
 * 运行：esbuild bundle 后 node（与 regex-match.test.mjs 相同方式）
 */
import assert from 'node:assert/strict'
import {
  parseWorldInfo,
  parseWorldInfoJson,
  parseWorldInfoCsv,
  parseCsvLine,
} from '../src/renderer/modules/world-info-import'
import { adaptiveInjectionBudget, expandSceneEntries, refsOf, matchWorldBookEntry } from '../src/renderer/modules/worldbook-match'

let passed = 0
const ok = (name, fn) => {
  fn()
  passed++
  console.log(`  ✔ ${name}`)
}

/* ===== 酒馆 World Info JSON ===== */
ok('WI JSON：keys/content/constant/insertion_order/enabled 映射', () => {
  const rows = parseWorldInfoJson(
    JSON.stringify([
      {
        keys: ['长安', '长安城'],
        content: '长安是大唐都城，人口百万。',
        constant: true,
        insertion_order: 2,
        enabled: true,
      },
      {
        keys: ['镇魔司'],
        content: '镇魔司掌天下妖事。',
        constant: false,
        insertion_order: 1,
        enabled: true,
      },
    ]),
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, '长安')
  assert.deepEqual(rows[0].keywords, ['长安', '长安城'])
  assert.equal(rows[0].triggerMode, 'always')
  assert.equal(rows[0].depth, 0)
  assert.equal(rows[0].order, 2)
  assert.equal(rows[1].triggerMode, 'keyword')
  assert.equal(rows[1].depth, 1)
  assert.equal(rows[1].order, 1)
})

ok('WI JSON：本项目导出包（无 keys）不误判', () => {
  const rows = parseWorldInfoJson(
    JSON.stringify([{ name: '测试', content: '内容', keywords: ['a'], enabled: true }]),
  )
  assert.equal(rows, null)
})

ok('WI JSON：非 JSON 文本返回 null', () => {
  assert.equal(parseWorldInfoJson('hello world'), null)
})

/* ===== 酒馆 CSV ===== */
ok('WI CSV：header 模式', () => {
  const rows = parseWorldInfoCsv(
    'keys,content,constant,selective,insertion_order,enabled,comment\n' +
      '"洛阳;神都",洛阳是东都。,true,false,3,true,注释\n' +
      '江湖,江湖门派林立。,false,false,1,true,',
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].keywords, ['洛阳', '神都'])
  assert.equal(rows[0].content, '洛阳是东都。')
  assert.equal(rows[0].triggerMode, 'always')
  assert.equal(rows[0].depth, 0)
  assert.equal(rows[0].order, 3)
  assert.equal(rows[1].triggerMode, 'keyword')
  assert.equal(rows[1].depth, 1)
  assert.equal(rows[1].order, 1)
})

ok('WI CSV：传统无 header（key,content,constant,order）', () => {
  const rows = parseWorldInfoCsv('长安,长安是都城。,1,0\n江南,江南水乡。,0,1')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].triggerMode, 'always')
  assert.equal(rows[1].triggerMode, 'keyword')
  assert.equal(rows[1].order, 1)
})

ok('parseCsvLine：引号内分号不拆分', () => {
  assert.deepEqual(parseCsvLine('"a;b",c'), ['a;b', 'c'])
})

/* ===== 注入体积自适应 ===== */
ok('adaptiveInjectionBudget：短对话微幅缩减', () => {
  assert.equal(adaptiveInjectionBudget(4000, 0), 4000)
  assert.equal(adaptiveInjectionBudget(4000, 100), 3975)
})
ok('adaptiveInjectionBudget：长对话线性缩减', () => {
  assert.equal(adaptiveInjectionBudget(4000, 8000), 2000)
  assert.equal(adaptiveInjectionBudget(6000, 12000), 3000)
})
ok('adaptiveInjectionBudget：超长对话保底 800', () => {
  assert.equal(adaptiveInjectionBudget(4000, 50000), 800)
})

/* ===== %keywords% 递归引用 ===== */
const mk = (id, name, content, keywords, extra = {}) => ({
  id,
  name,
  content,
  keywords,
  enabled: true,
  triggerMode: 'keyword',
  depth: 1,
  order: 0,
  ...extra,
})

ok('refsOf：提取 %条目名% 引用', () => {
  assert.deepEqual(refsOf(mk('1', 'a', 'c', ['%长安%', '普通词'])), ['长安'])
  assert.deepEqual(refsOf(mk('2', 'b', 'c', ['普通词'])), [])
})

ok('matchWorldBookEntry：%引用% 不参与普通匹配', () => {
  const e = mk('1', 'a', 'c', ['%长安%'])
  assert.equal(matchWorldBookEntry(e, '对话里出现长安'), false)
  const e2 = mk('2', 'b', 'c', ['%长安%', '镇魔司'])
  assert.equal(matchWorldBookEntry(e2, '对话里出现镇魔司'), true)
})

ok('expandSceneEntries：命中条目拉入 %引用% 条目（递归）', () => {
  const a = mk('a', '长安', '长安都城', ['长安', '%皇城%'])
  const b = mk('b', '皇城', '皇城禁地', ['%镇魔司%'])
  const c = mk('c', '镇魔司', '镇魔司衙门', ['镇魔司'])
  const d = mk('d', '江南', '江南水乡', ['江南'])
  const out = expandSceneEntries([a, b, c, d], '长安今夜有异动')
  const names = new Set(out.map((x) => x.name))
  assert.deepEqual([...names].sort(), ['长安', '皇城', '镇魔司'].sort())
})

ok('expandSceneEntries：防环（A<->B 互引）', () => {
  const a = mk('a', 'A', 'a内容', ['A词', '%B%'])
  const b = mk('b', 'B', 'b内容', ['%A%'])
  const out = expandSceneEntries([a, b], 'A词')
  assert.equal(out.length, 2)
})

ok('expandSceneEntries：常驻条目不参与场景递归', () => {
  const a = mk('a', 'A', 'a内容', ['A词', '%alwaysEntry%'])
  const al = mk('al', 'alwaysEntry', '常驻内容', ['x'], { triggerMode: 'always', depth: 0 })
  const out = expandSceneEntries([a, al], 'A词')
  assert.deepEqual(out.map((x) => x.name), ['A'])
})

/* ===== 统一入口 ===== */
ok('parseWorldInfo：JSON 与 CSV 均识别', () => {
  const j = parseWorldInfo(JSON.stringify([{ keys: ['a'], content: 'c', constant: false }]))
  assert.equal(j.length, 1)
  const csv = parseWorldInfo('keys,content,constant\nb,内容,false')
  assert.equal(csv.length, 1)
  assert.equal(parseWorldInfo('随便一段文本'), null)
})

console.log(`\n全部通过：${passed} 个用例`)
