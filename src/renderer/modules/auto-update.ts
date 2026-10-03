/**
 * Chatbox Mod 模块 —— 自动剧情更新（dynamicWB）
 *
 * AI 回复完成后，把最近对话 + 已装载条目摘要交给模型，让其输出增删改 JSON，
 * 合并写回世界书/人物卡。带并发锁、备份快照、日志与可选人工确认。
 */
import { getDefaultStore } from 'jotai'
import { v4 as uuidv4 } from 'uuid'
import { createModel } from '@/adapters'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { getSessionSettings } from '@/stores/session/session-settings'
import { getBinding } from './session'
import {
  addOrUpdateCharacterCard,
  addOrUpdateWorldBook,
  characterCardsAtom,
  modLog,
  modSettingsAtom,
  pushModBackup,
  removeCharacterCard,
  removeWorldBook,
  worldBooksAtom,
  DEFAULT_MOD_SETTINGS,
} from './store'
import type { CharacterCard, ModBackup, WorldBookEntry } from './types'
import { DEFAULT_CHUNK_SIZE, extractJsonBlock, splitTextChunks } from './analyze'

const log = getLogger('mod-auto-update')

/** 并发锁：同一时刻只允许一个自动更新在跑 */
let updating = false
/** 允许用户手动强制重置锁 */
export function forceUnlockAutoUpdate(): void {
  updating = false
  log.warn('auto-update lock force-released by user')
}
export function isAutoUpdateRunning(): boolean {
  return updating
}

function textOf(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((p): p is { type: 'text'; text: string } => Boolean(p && typeof p === 'object' && (p as { type?: unknown }).type === 'text'))
    .map((p) => String((p as { text?: unknown }).text ?? ''))
    .join('')
}

/** 从模型响应提取文本 */
function resultText(r: { contentParts?: unknown[]; content?: unknown }): string {
  if (Array.isArray(r.contentParts)) {
    const t = textOf(r.contentParts)
    if (t) return t
  }
  return typeof r.content === 'string' ? r.content : ''
}

/** 读取会话最近 N 条消息文本 */
async function getRecentDialogText(sid: string, n: number): Promise<string> {
  try {
    const session = await rendererApplication.sessionQueryBridge.getSession(sid)
    if (!session?.messages?.length) return ''
    return session.messages
      .slice(-n)
      .map((m) => textOf(m.contentParts ?? []))
      .filter(Boolean)
      .join('\n')
      .slice(0, 8000)
  } catch (e) {
    log.warn('getRecentDialogText failed', e)
    return ''
  }
}

/** 自动更新分析提示词（输出 JSON 差异） */
function buildUpdatePrompt(dialogText: string, loadedWb: string, loadedCc: string): string {
  return [
    '你是剧情设定维护助手。根据最新剧情对话，对以下"当前设定库"进行增、删、改，输出 JSON 差异。',
    '',
    '输出格式（只输出 JSON，不要多余文字）：',
    '{',
    '  "worldBooks": { "add": [{"name","content","keywords"}], "update": [{"name","content","keywords"}], "remove": ["名称"] },',
    '  "characters": { "add": [{"name","age","gender","occupation","appearance","height","weight","distinguishingFeatures","personalityType","strengths","weaknesses","hobbies","backgroundStory","relationships":[{"targetName","relation","description"}]}], "update": [同名同结构], "remove": ["名称"] }',
    '}',
    '',
    '规则：',
    '1. add（新增）：对话中出现、但当前设定库里没有的新设定/新人物。',
    '2. 新建人物卡必须输出完整字段：年龄/性别/职业/外貌/身高/体重/显著特征/性格类型/优点/缺点/爱好/背景故事/关系全部填写，拿不准的写"未知"，不许留空字符串。背景故事写完整（身世、经历、当前状态/立场）。',
    '3. update（更新）：已有条目被对话提供新信息或纠正时更新。必须输出合并后的完整内容——保留旧条目全部有效设定，只增补/修正对话中变化的部分，不得删减未被对话推翻的信息。',
    '4. remove（删除）：只删除被对话明确推翻或废弃的条目；不确定就保留。',
    '5. 没有变化就输出空数组。不要编造未出现的信息。',
    '',
    '--- 当前世界书 ---',
    loadedWb || '（空）',
    '',
    '--- 当前人物卡 ---',
    loadedCc || '（空）',
    '',
    '--- 最新剧情对话 ---',
    dialogText,
  ].join('\n')
}

/** 解析差异 JSON */
function parseDiff(raw: string): {
  wb: { add: Array<Record<string, unknown>>; update: Array<Record<string, unknown>>; remove: string[] }
  cc: { add: Array<Record<string, unknown>>; update: Array<Record<string, unknown>>; remove: string[] }
} | null {
  const parsed = extractJsonBlock(raw)
  if (!parsed || typeof parsed !== 'object') return null
  const r = parsed as Record<string, unknown>
  const wbRaw = (r.worldBooks ?? {}) as Record<string, unknown>
  const ccRaw = (r.characters ?? {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [])
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [])
  return {
    wb: { add: arr(wbRaw.add), update: arr(wbRaw.update), remove: names(wbRaw.remove) },
    cc: { add: arr(ccRaw.add), update: arr(ccRaw.update), remove: names(ccRaw.remove) },
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export interface AutoUpdateResult {
  ok: boolean
  error?: string
  wbAdd: number
  wbUpdate: number
  wbRemove: number
  ccAdd: number
  ccUpdate: number
  ccRemove: number
}

/** 更新预览：模型算出的差异，交给 UI 弹窗展示并让用户确认 */
export interface AutoUpdateDiff {
  wb: { add: Array<Record<string, unknown>>; update: Array<Record<string, unknown>>; remove: string[] }
  cc: { add: Array<Record<string, unknown>>; update: Array<Record<string, unknown>>; remove: string[] }
}

/**
 * 核心入口：触发一次自动更新。
 * @param sid 会话 id（取其设置、最近消息、装载条目）
 * @param opts.fixedTarget 固定目标会话 id（v48 的 target mode，可选）
 * @param opts.force 强制运行（无视锁）
 * @param opts.onPreview 若设置 requireConfirm，需弹「更新预览」让用户确认；返回「勾选后的差异 diff」（null 表示取消）；兼容旧 onConfirm（boolean）
 */
export async function maybeAutoUpdateWorldBooks(
  sid: string,
  opts: { fixedTarget?: string; force?: boolean; onConfirm?: () => Promise<boolean>; onPreview?: (diff: AutoUpdateDiff) => Promise<AutoUpdateDiff | null> } = {}
): Promise<AutoUpdateResult> {
  const target = opts.fixedTarget ?? sid
  if (updating && !opts.force) return { ok: false, error: '已有更新任务进行中', wbAdd: 0, wbUpdate: 0, wbRemove: 0, ccAdd: 0, ccUpdate: 0, ccRemove: 0 }
  if (opts.force) updating = false
  updating = true

  const result: AutoUpdateResult = { ok: false, wbAdd: 0, wbUpdate: 0, wbRemove: 0, ccAdd: 0, ccUpdate: 0, ccRemove: 0 }
  try {
    const store = getDefaultStore()
    const settings = store.get(modSettingsAtom)
    const binding = await getBinding(target)
    const allWb = store.get(worldBooksAtom)
    const allCc = store.get(characterCardsAtom)
    const loadedWb = allWb.filter((w) => binding.worldBookIds.includes(w.id) && w.enabled !== false)
    const loadedCc = allCc.filter((c) => binding.characterCardIds.includes(c.id) && c.enabled !== false)

    const dialogText = await getRecentDialogText(target, settings.recentMessages || DEFAULT_MOD_SETTINGS.recentMessages)

    // 没有可分析的内容就直接跳过
    if (!dialogText.trim() && loadedWb.length === 0 && loadedCc.length === 0) {
      result.ok = true
      return result
    }

    const sessionSettings = await getSessionSettings(target)
    const model = await createModel(sessionSettings)
    const prompt = buildUpdatePrompt(
      dialogText,
      loadedWb.map((w) => `- ${w.name}: ${String(w.content ?? '').slice(0, 4000)}`).join('\n'),
      loadedCc.map((c) => `- ${c.name}: ${String(c.backgroundStory ?? '').slice(0, 6000)}`).join('\n')
    )
    const modelResult = await model.chat(
      [
        { role: 'system', content: '你是严谨的设定维护助手，只输出 JSON。' },
        { role: 'user', content: prompt },
      ], {}
  )
    const raw = resultText(modelResult)
    let diff = parseDiff(raw)
    if (!diff) {
      throw new Error('模型输出无法解析为 JSON 差异')
    }

    // 人工确认（可配置）：优先展示「更新预览」供用户逐条勾选（返回勾选后的差异）
    if (settings.requireConfirm) {
      if (opts.onPreview) {
        const picked = await opts.onPreview(diff)
        if (!picked) {
          result.ok = false
          result.error = '已取消'
          return result
        }
        diff = picked
      } else if (opts.onConfirm) {
        const confirmed = await opts.onConfirm()
        if (!confirmed) {
          result.ok = false
          result.error = '已取消'
          return result
        }
      }
    }

    // 备份快照（应用变更前）
    const backup: ModBackup = {
      t: Date.now(),
      wbBack: loadedWb.map((w) => ({ id: w.id, name: w.name, content: w.content, keywords: w.keywords, enabled: w.enabled })),
      ccBack: loadedCc.map((c) => ({
        id: c.id,
        name: c.name,
        enabled: c.enabled,
        age: c.age,
        gender: c.gender,
        occupation: c.occupation,
        appearance: c.appearance,
        personalityType: c.personalityType,
        backgroundStory: c.backgroundStory,
        relationships: c.relationships,
        characterBook: c.characterBook,
        customAttributes: c.customAttributes,
      })),
      wbAddNames: diff.wb.add.map((x) => str(x.name)).filter(Boolean),
      ccAddNames: diff.cc.add.map((x) => str(x.name)).filter(Boolean),
    }

    // 世界书：新增/更新（按名称匹配）
    const wbByName = new Map(allWb.map((w) => [w.name, w]))
    for (const item of diff.wb.add) {
      const name = str(item.name)
      if (!name) continue
      const existing = wbByName.get(name)
      const entry: WorldBookEntry = {
        id: existing?.id ?? uuidv4(),
        name,
        content: str(item.content),
        keywords: Array.isArray(item.keywords) ? item.keywords.map((k) => String(k)) : [],
        enabled: true,
        triggerMode: 'always',
        depth: 0, // 剧情状态常驻最前：模型每轮都带着最新进展（受 wbInjectionLimit 截断保护）
        updatedAt: Date.now(),
        createdAt: existing?.createdAt ?? Date.now(),
      }
      await addOrUpdateWorldBook(entry)
      wbByName.set(name, entry)
      if (existing) result.wbUpdate++
      else {
        result.wbAdd++
        // 新增条目自动装载到当前会话
        binding.worldBookIds = [...new Set([...binding.worldBookIds, entry.id])]
      }
    }
    for (const item of diff.wb.update) {
      const name = str(item.name)
      const existing = wbByName.get(name)
      if (!existing) continue
      await addOrUpdateWorldBook({ ...existing, content: str(item.content) || existing.content, keywords: Array.isArray(item.keywords) && item.keywords.length ? item.keywords.map((k) => String(k)) : existing.keywords })
      result.wbUpdate++
    }
    for (const name of diff.wb.remove) {
      const existing = wbByName.get(name)
      if (!existing) continue
      await removeWorldBook(existing.id)
      binding.worldBookIds = binding.worldBookIds.filter((id) => id !== existing.id)
      result.wbRemove++
    }

    // 人物卡：新增/更新（按名称匹配）
    const ccByName = new Map(allCc.map((c) => [c.name, c]))
    for (const item of diff.cc.add) {
      const name = str(item.name)
      if (!name) continue
      const existing = ccByName.get(name)
      const card: CharacterCard = {
        id: existing?.id ?? uuidv4(),
        name,
        age: str(item.age),
        gender: str(item.gender),
        occupation: str(item.occupation),
        appearance: str(item.appearance),
        height: '',
        weight: '',
        distinguishingFeatures: '',
        personalityType: str(item.personalityType),
        strengths: '',
        weaknesses: '',
        hobbies: '',
        backgroundStory: str(item.backgroundStory),
        relationships: Array.isArray(item.relationships)
          ? item.relationships
              .filter((x) => x && typeof x === 'object' && str((x as Record<string, unknown>).targetName))
              .map((x) => ({ targetName: str((x as Record<string, unknown>).targetName), relation: str((x as Record<string, unknown>).relation), description: '' }))
          : [],
        customAttributes: [],
        characterBook: [],
        enabled: true,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        versionHistory: existing?.versionHistory ?? [],
      }
      await addOrUpdateCharacterCard(card)
      ccByName.set(name, card)
      if (existing) result.ccUpdate++
      else {
        result.ccAdd++
        binding.characterCardIds = [...new Set([...binding.characterCardIds, card.id])]
      }
    }
    for (const item of diff.cc.update) {
      const name = str(item.name)
      const existing = ccByName.get(name)
      if (!existing) continue
      await addOrUpdateCharacterCard({
        ...existing,
        backgroundStory: str(item.backgroundStory) || existing.backgroundStory,
        relationships: Array.isArray(item.relationships) && item.relationships.length ? existing.relationships : existing.relationships,
        updatedAt: Date.now(),
      })
      result.ccUpdate++
    }
    for (const name of diff.cc.remove) {
      const existing = ccByName.get(name)
      if (!existing) continue
      await removeCharacterCard(existing.id)
      binding.characterCardIds = binding.characterCardIds.filter((id) => id !== existing.id)
      result.ccRemove++
    }

    // 装载变化写回会话
    if (binding.worldBookIds.length > 0 || binding.characterCardIds.length > 0) {
      const { setBinding } = await import('./session')
      await setBinding(target, binding)
    }

    await pushModBackup(backup)
    await modLog('auto-update', { ...result }, target)
    result.ok = true
    return result
  } catch (e) {
    result.ok = false
    result.error = String((e as Error)?.message ?? e)
    log.error('auto-update failed', e)
    await modLog('auto-update-error', { error: result.error }, target)
    return result
  } finally {
    updating = false
  }
}

/** 长文分析：把一段文本整体分析并合并进世界书/人物卡库（不绑定会话） */
export async function analyzeTextAndBuildWorld(
  text: string,
  opts: { sessionSettingsForModel?: Awaited<ReturnType<typeof getSessionSettings>>; model?: Awaited<ReturnType<typeof createModel>> } = {}
): Promise<{ ok: boolean; wbAdd: number; ccAdd: number; error?: string }> {
  try {
    const chunks = splitTextChunks(text, DEFAULT_CHUNK_SIZE)
    if (chunks.length === 0) return { ok: false, wbAdd: 0, ccAdd: 0, error: '文本为空' }

    const { mergeAnalysisResult, parseAnalysisOutput, buildAnalysisPrompt } = await import('./analyze')
    const store = getDefaultStore()
    const model = opts.model ?? (opts.sessionSettingsForModel ? await createModel(opts.sessionSettingsForModel) : null)
    if (!model) return { ok: false, wbAdd: 0, ccAdd: 0, error: '缺少模型上下文' }

    const results = []
    for (const chunk of chunks) {
      const r = await model.chat(
        [
          { role: 'system', content: '你是设定提取助手，只输出 JSON。' },
          { role: 'user', content: buildAnalysisPrompt(chunk) },
        ], {}
  )
      results.push(parseAnalysisOutput(resultText(r)))
    }
    const merged = mergeAnalysisResult(results)
    const { analysisToEntries } = await import('./analyze')
    const { wb, cc } = analysisToEntries(merged)

    const allWb = store.get(worldBooksAtom)
    const allCc = store.get(characterCardsAtom)
    const wbByName = new Map(allWb.map((x) => [x.name, x]))
    const ccByName = new Map(allCc.map((x) => [x.name, x]))

    let wbAdd = 0
    let ccAdd = 0
    for (const w of wb) {
      const existing = wbByName.get(w.name)
      await addOrUpdateWorldBook(existing ? { ...existing, content: w.content || existing.content, keywords: [...new Set([...existing.keywords, ...w.keywords])], enabled: true } : { ...w, id: uuidv4() })
      if (!existing) wbAdd++
    }
    for (const c of cc) {
      const existing = ccByName.get(c.name)
      if (existing) {
        await addOrUpdateCharacterCard({ ...existing, ...c, id: existing.id, backgroundStory: c.backgroundStory || existing.backgroundStory })
      } else {
        await addOrUpdateCharacterCard({ ...c, id: uuidv4() })
        ccAdd++
      }
    }
    await modLog('analyze', { chunks: chunks.length, wbAdd, ccAdd })
    return { ok: true, wbAdd, ccAdd }
  } catch (e) {
    log.error('analyzeTextAndBuildWorld failed', e)
    return { ok: false, wbAdd: 0, ccAdd: 0, error: String((e as Error)?.message ?? e) }
  }
}
