/**
 * Chatbox Mod 回归测试 —— 对话存档分支点（branches）
 * 覆盖：打点/取消 toggle、会话过滤、删消息联动清理、多消息清理、序号
 */
import {
  toggleBookmark, isBookmarked, sessionBookmarks, sortedSessionBookmarks,
  dropBookmarksForMessage, dropBookmarksForMessages, clearSessionBookmarks,
  bookmarkMessageIndex,
} from '../src/renderer/modules/branches'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) }
  else { fail++; console.log(`FAIL ${name}`) }
}

function main() {
  // ---- 打点 / 取消（toggle）----
  {
    const r1 = toggleBookmark([], 's1', 'm1', '第一条内容预览', '起点')
    check('打点:首次打点 added=true', r1.added === true)
    check('打点:写入会话/消息/预览/标签', r1.list.length === 1 && r1.list[0].sessionId === 's1' && r1.list[0].messageId === 'm1' && r1.list[0].preview === '第一条内容预览' && r1.list[0].label === '起点')
    check('打点:生成 id', typeof r1.list[0].id === 'string' && r1.list[0].id.length > 0)
    check('打点:记录时间戳', typeof r1.list[0].timestamp === 'number')

    const r2 = toggleBookmark(r1.list, 's1', 'm1', 'xxx')
    check('取消:再次打点同消息 added=false', r2.added === false)
    check('取消:条目被移除', r2.list.length === 0)

    const r3 = toggleBookmark(r1.list, 's1', 'm2', '第二条')
    check('多打点:不同消息可并存', r3.list.length === 2)
  }

  // ---- 会话过滤 ----
  {
    const list = [
      { id: 'a', sessionId: 's1', messageId: 'm1', timestamp: 1, preview: 'A' },
      { id: 'b', sessionId: 's2', messageId: 'm2', timestamp: 2, preview: 'B' },
      { id: 'c', sessionId: 's1', messageId: 'm3', timestamp: 3, preview: 'C' },
    ]
    check('会话过滤:只留本会话', sessionBookmarks(list, 's1').length === 2)
    check('会话过滤:isBookmarked 命中', isBookmarked(list, 's1', 'm1') === true)
    check('会话过滤:跨会话不命中', isBookmarked(list, 's2', 'm1') === false)
    check('会话过滤:排序按时间升序', sortedSessionBookmarks(list, 's1').map((b) => b.messageId).join(',') === 'm1,m3')
  }

  // ---- 删消息联动清理 ----
  {
    const list = [
      { id: 'a', sessionId: 's1', messageId: 'm1', timestamp: 1, preview: 'A' },
      { id: 'b', sessionId: 's1', messageId: 'm2', timestamp: 2, preview: 'B' },
      { id: 'c', sessionId: 's2', messageId: 'm2', timestamp: 3, preview: 'C' },
    ]
    const r = dropBookmarksForMessage(list, 's1', 'm1')
    check('删消息:本会话该消息存档点被清理', r.length === 2 && !r.some((b) => b.messageId === 'm1' && b.sessionId === 's1'))
    check('删消息:其他会话同名消息不受影响', r.some((b) => b.sessionId === 's2' && b.messageId === 'm2'))

    const r2 = dropBookmarksForMessages(list, 's1', ['m1', 'm2'])
    check('多删:跨位置批量清理', r2.length === 1 && r2[0].sessionId === 's2')
    check('多删:无匹配时原样返回', dropBookmarksForMessages(list, 's3', ['m9']).length === 3)
  }

  // ---- 清空会话 / 序号 ----
  {
    const list = [
      { id: 'a', sessionId: 's1', messageId: 'm1', timestamp: 1, preview: 'A' },
      { id: 'b', sessionId: 's2', messageId: 'm2', timestamp: 2, preview: 'B' },
    ]
    check('清空:只清本会话', clearSessionBookmarks(list, 's1').length === 1)
    check('序号:命中返回第N条', bookmarkMessageIndex(['m0', 'm1', 'm2'], 'm1') === 2)
    check('序号:未命中返回0', bookmarkMessageIndex(['m0'], 'm9') === 0)
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main()
