/**
 * Chatbox Mod —— 群聊模式注入模板测试（M0-1）
 * 验证 buildWorldInjection 在 chatMode='group' 时输出群聊规则与角色名单，
 * 在 creation 模式保持原有注入格式。
 */
import assert from 'node:assert/strict'
import { getDefaultStore } from 'jotai'
import { buildWorldInjection } from '../src/renderer/modules/prompt.ts'
import { modSettingsAtom, characterCardsAtom, worldBooksAtom } from '../src/renderer/modules/store.ts'

let passed = 0
let failed = 0
async function ok(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✔ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✘ ${name}\n    ${e.message}`)
  }
}

const store = getDefaultStore()

function withCards(cards, wb = []) {
  store.set(characterCardsAtom, cards)
  store.set(worldBooksAtom, wb)
}

await ok('群聊模式：输出群聊规则与角色名单', async () => {
  store.set(modSettingsAtom, { ...store.get(modSettingsAtom), chatMode: 'group' })
  withCards([
    { id: 'a', name: '罗素', personalityType: '豪爽', occupation: '船长', backgroundStory: '加勒比海盗', enabled: true },
    { id: 'b', name: '林晚', personalityType: '冷静', occupation: '医师', backgroundStory: '宫廷医女', enabled: true },
  ])
  const out = await buildWorldInjection([], ['a', 'b'], '你们在甲板上')
  assert.ok(out.includes('## 群聊规则'), '应包含群聊规则标题')
  assert.ok(out.includes('角色名：台词'), '应包含发言格式')
  assert.ok(out.includes('系统事件'), '应包含系统事件规则')
  assert.ok(out.includes('【罗素】'), '应包含角色名单')
  assert.ok(out.includes('【林晚】'), '应包含角色名单')
  assert.ok(!out.includes('## Character Cards'), '群聊模式不输出原人物卡格式')
})

await ok('群聊模式：无角色时提示空名单', async () => {
  store.set(modSettingsAtom, { ...store.get(modSettingsAtom), chatMode: 'group' })
  withCards([])
  const out = await buildWorldInjection([], [], '')
  assert.ok(out.includes('群聊规则'), '仍输出规则')
  assert.ok(out.includes('当前无角色名单'), '提示无角色')
})

await ok('群聊模式：世界书常驻设定仍注入', async () => {
  store.set(modSettingsAtom, { ...store.get(modSettingsAtom), chatMode: 'group' })
  withCards(
    [{ id: 'a', name: '罗素', enabled: true }],
    [{ id: 'w1', name: '世界观', content: '加勒比海域魔法盛行', keywords: [], triggerMode: 'always', enabled: true }]
  )
  const out = await buildWorldInjection(['w1'], ['a'], '')
  assert.ok(out.includes('加勒比海域魔法盛行'), '世界书常驻注入')
})

await ok('创作模式：保持原人物卡注入格式', async () => {
  store.set(modSettingsAtom, { ...store.get(modSettingsAtom), chatMode: 'creation' })
  withCards([{ id: 'a', name: '罗素', personalityType: '豪爽', enabled: true }])
  const out = await buildWorldInjection([], ['a'], '')
  assert.ok(out.includes('## Character Cards'), '原格式')
  assert.ok(out.includes('【罗素】'), '角色段')
  assert.ok(!out.includes('## 群聊规则'), '无群聊规则')
})

console.log(`\n全部通过：${passed} 个用例${failed > 0 ? `，失败 ${failed} 个` : ''}`)
process.exit(failed > 0 ? 1 : 0)
