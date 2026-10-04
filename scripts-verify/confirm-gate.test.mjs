/**
 * Chatbox Mod 回归测试 —— 自动更新写回前确认门（runConfirmGate）
 * 跑法：esbuild bundle 后 node 执行
 */
import { runConfirmGate } from '../src/renderer/modules/confirm-gate'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

const mkDiff = () => ({ wb: { add: [{ name: '甲' }], update: [], remove: [] }, cc: { add: [], update: [], remove: [] } })

async function main() {
  // 1. requireConfirm=false → 直接放行（用户明确选择不确认）
  {
    const r = await runConfirmGate(false, {}, mkDiff())
    check('放行:不要求确认时直接通过', r.ok === true && r.diff.wb.add.length === 1)
  }

  // 2. onPreview 正常返回勾选后的 diff → 放行
  {
    const picked = { wb: { add: [], update: [], remove: [] }, cc: { add: [], update: [], remove: [] } }
    const r = await runConfirmGate(true, { onPreview: async () => picked }, mkDiff())
    check('预览:用户勾选返回diff并放行', r.ok === true && r.diff === picked)
  }

  // 3. onPreview 用户取消（null）→ 中止，不写回
  {
    const r = await runConfirmGate(true, { onPreview: async () => null }, mkDiff())
    check('预览:取消则中止', r.ok === false && r.error === '已取消')
  }

  // 4. onPreview 抛异常 → 中止（弹窗故障也不能静默写回）
  {
    const r = await runConfirmGate(true, { onPreview: async () => { throw new Error('boom') } }, mkDiff())
    check('预览:弹窗异常则中止', r.ok === false && r.error.indexOf('弹窗异常') !== -1)
  }

  // 5. 旧式 onConfirm 确认 → 放行；拒绝 → 中止
  {
    const ok = await runConfirmGate(true, { onConfirm: async () => true }, mkDiff())
    check('确认:同意放行', ok.ok === true)
    const no = await runConfirmGate(true, { onConfirm: async () => false }, mkDiff())
    check('确认:拒绝中止', no.ok === false && no.error === '已取消')
  }

  // 6. 要求确认但无任何确认通道 → 中止（fail-safe，绝不静默写回）
  {
    const r = await runConfirmGate(true, {}, mkDiff())
    check('fail-safe:无确认通道则中止', r.ok === false && r.error.indexOf('缺少确认弹窗通道') !== -1)
  }

  // 7. onPreview 与 onConfirm 同时存在 → 优先 onPreview
  {
    let confirmCalled = false
    const r = await runConfirmGate(true, {
      onPreview: async (d) => d,
      onConfirm: async () => { confirmCalled = true; return true },
    }, mkDiff())
    check('优先级:onPreview优先于onConfirm', r.ok === true && confirmCalled === false)
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

void main()
