/**
 * PNG 人物卡导入回归测试（V13）
 * 构造含 tEXt chunk 的最小 PNG，验证 ccv3 / chara 两种标准都能解析映射。
 */
import assert from 'node:assert'
import {
  isPngBytes,
  parsePngTextChunks,
  parseCharacterCardPng,
  parseCharacterCardJson,
  detectCardJsonFormat,
  diagnosePngCard,
  mapTavernCardToMod,
} from '../src/renderer/modules/png-character-import.ts'

let passed = 0
let failed = 0
function ok(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✔ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✘ ${name}`)
    console.log(e)
  }
}

/** CRC32（PNG chunk 校验用） */
function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

/** 构造一个最小 PNG：签名 + IHDR + 若干 tEXt + IEND */
function makePng(textChunks) {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [sig]
  const chunk = (type, data) => {
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, data.length)
    const typeB = new TextEncoder().encode(type)
    const body = new Uint8Array([...len, ...typeB, ...data])
    const crc = new Uint8Array(4)
    new DataView(crc.buffer).setUint32(0, crc32(body.subarray(4)))
    parts.push(new Uint8Array([...body, ...crc]))
  }
  // IHDR：1x1 RGBA
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, 1)
  new DataView(ihdr.buffer).setUint32(4, 1)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  chunk('IHDR', ihdr)
  for (const { keyword, text } of textChunks) {
    const kw = new TextEncoder().encode(keyword)
    const tx = new TextEncoder().encode(text)
    chunk('tEXt', new Uint8Array([...kw, 0, ...tx]))
  }
  chunk('IEND', new Uint8Array(0))
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    all.set(p, off)
    off += p.length
  }
  return all
}

const ccv3Card = {
  spec: 'chara_card_v3',
  name: '罗素',
  description: '出身加勒比的海盗船长，性格张扬不羁。',
  personality: '豪爽、狡黠、重情义',
  scenario: '加勒比海域，一艘黑帆商船。',
  first_mes: '呵，上船了就别想下去。',
  mes_example: '<START>\n{{user}}: 你是谁？\n{{char}}: 罗素，加勒比最自由的船长。',
  creator: '作者A',
  creator_notes: '自用卡，偏群像剧。',
  alternate_greetings: ['哟，新来的水手？', '风浪大得很，正好喝一杯。'],
  character_book: {
    entries: [
      {
        keys: ['加勒比', '黑帆'],
        content: '加勒比海域的势力分布与黑帆商船的背景。',
        constant: true,
        depth: 0,
        order: 0,
      },
      {
        keys: ['罗素'],
        content: '罗素的过往经历。',
        enabled: true,
        depth: 1,
        order: 1,
      },
    ],
  },
}

ok('isPngBytes：识别 PNG 魔数', () => {
  assert.equal(isPngBytes(makePng([])), true)
  assert.equal(isPngBytes(new TextEncoder().encode('hello')), false)
})

ok('parsePngTextChunks：提取 tEXt', () => {
  const png = makePng([
    { keyword: 'ccv3', text: JSON.stringify(ccv3Card) },
    { keyword: 'Software', text: 'test' },
  ])
  const chunks = parsePngTextChunks(png)
  assert.deepEqual(
    chunks.map((c) => c.keyword),
    ['ccv3', 'Software'],
  )
})

ok('parseCharacterCardPng：ccv3 标准解析', () => {
  const png = makePng([{ keyword: 'ccv3', text: JSON.stringify(ccv3Card) }])
  const card = parseCharacterCardPng(png)
  assert.ok(card)
  assert.equal(card.name, '罗素')
  assert.equal(card.description, '出身加勒比的海盗船长，性格张扬不羁。')
  assert.equal(card.first_mes, '呵，上船了就别想下去。')
  assert.equal(card.alternate_greetings?.length, 2)
  assert.equal(card.character_book?.entries?.length, 2)
})

ok('parseCharacterCardPng：chara base64 兼容', () => {
  const b64 = Buffer.from(JSON.stringify(ccv3Card)).toString('base64')
  const png = makePng([{ keyword: 'chara', text: b64 }])
  const card = parseCharacterCardPng(png)
  assert.ok(card)
  assert.equal(card.name, '罗素')
})

ok('parseCharacterCardPng：无数据返回 null', () => {
  const png = makePng([{ keyword: 'Software', text: 'plain' }])
  assert.equal(parseCharacterCardPng(png), null)
  assert.equal(parseCharacterCardPng(new Uint8Array(16)), null)
})

ok('parseCharacterCardJson：data 包装兼容', () => {
  const card = parseCharacterCardJson(JSON.stringify({ data: ccv3Card }))
  assert.ok(card)
  assert.equal(card.name, '罗素')
  assert.equal(parseCharacterCardJson('not json'), null)
})

ok('mapTavernCardToMod：字段映射', () => {
  const card = parseCharacterCardPng(makePng([{ keyword: 'ccv3', text: JSON.stringify(ccv3Card) }]))
  assert.ok(card)
  const m = mapTavernCardToMod(card)
  assert.equal(m.fields.name, '罗素')
  assert.equal(m.fields.backgroundStory, '出身加勒比的海盗船长，性格张扬不羁。')
  assert.equal(m.fields.personalityType, '豪爽、狡黠、重情义')
  const keys = m.fields.customAttributes.map((a) => a.key)
  assert.ok(keys.includes('场景') && keys.includes('开场白') && keys.includes('作者注释'))
  assert.ok(keys.includes('备用开场白') && keys.includes('示例对话'))
})

ok('mapTavernCardToMod：世界书条目映射', () => {
  const card = parseCharacterCardPng(makePng([{ keyword: 'ccv3', text: JSON.stringify(ccv3Card) }]))
  assert.ok(card)
  const m = mapTavernCardToMod(card)
  assert.equal(m.bookEntries.length, 2)
  const always = m.bookEntries[0]
  assert.equal(always.triggerMode, 'always')
  assert.equal(always.depth, 0)
  assert.deepEqual(always.keywords, ['加勒比', '黑帆'])
  const kw = m.bookEntries[1]
  assert.equal(kw.triggerMode, 'keyword')
  assert.equal(kw.depth, 1)
  assert.equal(kw.enabled, true)
})

// ===== A 阶段：智能导入（格式识别 + PNG 失败诊断） =====

const wrappedCcv3 = JSON.stringify({
  spec: 'chara_card_v2',
  data: {
    name: '包装卡',
    description: '描述',
    personality: '性格',
    first_mes: '开场',
  },
})
const tavernTopLevel = JSON.stringify({
  name: '顶层酒馆卡',
  description: '描述',
  personality: '性格',
  first_mes: '开场',
  scenario: '场景',
})
const internalSingle = JSON.stringify({
  name: '内部单卡',
  backgroundStory: '背景',
  age: '28',
  customAttributes: [{ key: 'k', value: 'v' }],
})
const nameOnly = JSON.stringify({ name: '仅名字' })
const internalArray = JSON.stringify([{ name: 'A' }, { name: 'B' }])
const exportPkg = JSON.stringify({ characterCards: [{ name: 'C' }], worldBooks: [{ name: 'W' }] })

ok('detectCardJsonFormat：数组 → array', () => {
  assert.equal(detectCardJsonFormat(internalArray), 'array')
})
ok('detectCardJsonFormat：导出包 → array（characterCards 优先）', () => {
  assert.equal(detectCardJsonFormat(exportPkg), 'array')
})
ok('detectCardJsonFormat：{spec,data} CCv3 → ccv3', () => {
  assert.equal(detectCardJsonFormat(wrappedCcv3), 'ccv3')
})
ok('detectCardJsonFormat：{data:{name}} 包装 → ccv3', () => {
  assert.equal(detectCardJsonFormat(JSON.stringify({ data: { name: 'X' } })), 'ccv3')
})
ok('detectCardJsonFormat：顶层酒馆卡 → tavern', () => {
  assert.equal(detectCardJsonFormat(tavernTopLevel), 'tavern')
})
ok('detectCardJsonFormat：内部单卡（有内部特征）→ internal', () => {
  assert.equal(detectCardJsonFormat(internalSingle), 'internal')
})
ok('detectCardJsonFormat：仅 name → internal（零回归）', () => {
  assert.equal(detectCardJsonFormat(nameOnly), 'internal')
})
ok('detectCardJsonFormat：非法 JSON → unknown', () => {
  assert.equal(detectCardJsonFormat('not json{'), 'unknown')
})

ok('parseCharacterCardJson：包装式 CCv3 → 解析出卡', () => {
  const card = parseCharacterCardJson(wrappedCcv3)
  assert.ok(card)
  assert.equal(card.name, '包装卡')
})
ok('parseCharacterCardJson：顶层酒馆卡 → 解析出卡', () => {
  const card = parseCharacterCardJson(tavernTopLevel)
  assert.ok(card)
  assert.equal(card.name, '顶层酒馆卡')
})
ok('parseCharacterCardJson：缺 name → null', () => {
  assert.equal(parseCharacterCardJson(JSON.stringify({ description: 'x' })), null)
})

ok('diagnosePngCard：无 tEXt → no-chunk', () => {
  const r = diagnosePngCard(makePng([]))
  assert.equal(r.branch, 'no-chunk')
})
ok('diagnosePngCard：有 tEXt 但无 ccv3/chara → no-keyword', () => {
  const r = diagnosePngCard(makePng([{ keyword: 'Comment', text: 'hello' }]))
  assert.equal(r.branch, 'no-keyword')
  assert.equal(r.chunkCount, 1)
})
ok('diagnosePngCard：ccv3 JSON 损坏 → json-error', () => {
  const r = diagnosePngCard(makePng([{ keyword: 'ccv3', text: '{broken' }]))
  assert.equal(r.branch, 'json-error')
  assert.ok(r.error)
})
ok('diagnosePngCard：ccv3 缺 name → no-name', () => {
  const r = diagnosePngCard(makePng([{ keyword: 'ccv3', text: JSON.stringify({ description: 'x' }) }]))
  assert.equal(r.branch, 'no-name')
})
ok('diagnosePngCard：正常卡 → ok', () => {
  const r = diagnosePngCard(makePng([{ keyword: 'ccv3', text: JSON.stringify(ccv3Card) }]))
  assert.equal(r.branch, 'ok')
})
ok('diagnosePngCard：chara base64 正常 → ok', () => {
  const b64 = Buffer.from(JSON.stringify({ name: '罗素', description: 'd' })).toString('base64')
  const r = diagnosePngCard(makePng([{ keyword: 'chara', text: b64 }]))
  assert.equal(r.branch, 'ok')
})


console.log(`\n全部通过：${passed} 个用例${failed > 0 ? `，失败 ${failed} 个` : ''}`)
process.exit(failed > 0 ? 1 : 0)
