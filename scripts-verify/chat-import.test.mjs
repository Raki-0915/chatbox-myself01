/**
 * Chatbox Mod —— 导入聊天记录：系统提示词保留测试
 * 验证 toSessionMessages 保留 role='system' 消息并置于最前（系统提示词不丢）。
 */
import assert from 'node:assert/strict'
import { parseChatImport, toSessionMessages } from '../src/renderer/modules/chat-import.ts'

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

await ok('md 导出：system 段还原为系统消息', async () => {
  const md = [
    '# 测试会话',
    '',
    '**system**: ',
    '',
    '```',
    '你是罗素船长，说话豪爽。',
    '```',
    '',
    '**user**: ',
    '',
    '```',
    '你好',
    '```',
    '',
    '**assistant**: ',
    '',
    '```',
    '哈哈，上船吧！',
    '```',
    '',
  ].join('\n')
  const parsed = parseChatImport(md, 'a.md')
  assert.ok(parsed.ok, '解析成功')
  assert.equal(parsed.messages.filter((m) => m.role === 'system').length, 1, '包含 system 消息')
})

await ok('toSessionMessages：系统提示词保留且置于最前', async () => {
  const parsed = parseChatImport(
    [
      '# 会话',
      '',
      '**system**: ',
      '',
      '```',
      '你是罗素船长。',
      '```',
      '',
      '**user**: ',
      '',
      '```',
      '你好',
      '```',
      '',
    ].join('\n'),
    'a.md'
  )
  const msgs = toSessionMessages(parsed.messages)
  assert.equal(msgs.length, 2, '共 2 条消息（system 不再被丢弃）')
  assert.equal(msgs[0].role, 'system', '第一条是系统提示词')
  assert.ok(String(msgs[0].contentParts?.[0]?.text ?? '').includes('罗素船长'), '系统提示词内容完整')
  assert.equal(msgs[1].role, 'user', '第二条是用户消息')
})

await ok('toSessionMessages：无 system 时保持原样', async () => {
  const msgs = toSessionMessages([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '哈哈' },
  ])
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].role, 'user')
  assert.equal(msgs[1].role, 'assistant')
})

console.log(`\n全部通过：${passed} 个用例${failed > 0 ? `，失败 ${failed} 个` : ''}`)
process.exit(failed > 0 ? 1 : 0)
