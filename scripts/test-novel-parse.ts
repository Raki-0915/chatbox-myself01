import { readFileSync } from 'fs'
import { parseNovelImport } from '../src/renderer/modules/novel-rewrite'
const text = readFileSync(process.argv[2], 'utf-8')
const r = parseNovelImport(text)
if (!r.ok) { console.log("FAIL", r.errors.slice(0, 10)); process.exit(1) }
console.log("WARN", r.warnings.length, "条:", r.warnings.slice(0, 5).join(" | "))
const b = r.book!
console.log('OK bookId:', b.bookId, '| name:', b.bookName)
console.log('chapters:', b.chapters.length, '| baselines:', b.baselines.length, '| events:', b.events.length, '| worldbook:', b.worldbook.length)
console.log('首章:', b.chapters[0].chIndex, b.chapters[0].title, '| 末章:', b.chapters.at(-1)?.chIndex, b.chapters.at(-1)?.title)
console.log('首章原文字数:', b.chapters[0].original.length)
console.log('首章原预告:', JSON.stringify(b.chapters[0].originalPreview[0]))
console.log('事件chapter范围:', b.events[0]?.chapter, '~', b.events.at(-1)?.chapter)
console.log('人物:', b.baselines.map(x => x.name).join('、'))
