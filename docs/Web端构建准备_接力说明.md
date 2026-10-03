# Chatbox Mod · Web 端构建准备与接力说明

> 生成时间：2026-10-03
> 用途：**给接手的另一个 AI**。按本文档在本机把 Web 预览开发环境跑起来，即可开始开发新功能。

---

## 0. 三句话背景

- 这是 **Chatbox v1.23.5 的 Fork 改造版**，个人自用，新增世界书/人物卡/分章续写/自动剧情更新等能力
- 所有自研功能在 `src/renderer/modules/`（12 个 TS 文件），官方源码只有 3 处侵入点（带 `[Chatbox Mod]` 注释）
- **开发流程：web 预览写代码/验逻辑（秒级反馈）→ 本地/CI 出 APK → 手机验收**

## 1. 获取代码

```bash
git clone https://github.com/Raki-0915/chatbox-myself01.git
cd chatbox-myself01
# 当前 main 分支即最新版（含 android 工程、CI 配置、README 规则文档）
```

## 2. 环境要求

| 组件 | 版本 | 说明 |
|---|---|---|
| Node.js | **>= 22.13 且 < 23** | engines 硬约束 |
| pnpm | **10.33.0** | packageManager 锁定 |

> 只需要 Node + pnpm 就能跑 Web 预览。JDK21/Android SDK 是出 APK 才需要（本文档不管）。

## 3. 安装依赖（首次约 10-18 分钟）

```bash
pnpm install --frozen-lockfile
# 若下载 electron 二进制慢/失败，可加 ELECTRON_SKIP_BINARY_DOWNLOAD=1（web 预览不需要 electron 可执行文件）
```

## 4. 启动 Web 预览（开发主力）

```bash
pnpm dev:web
# 等价于: cross-env DEV_WEB_ONLY=true CHATBOX_BUILD_PLATFORM=web pnpm start
```
浏览器自动打开（默认 http://localhost:5173 附近），**改代码热更新秒级生效**。

备选（不带 electron 外壳，纯 vite）：
```bash
pnpm dev:web:standalone   # vite --config vite.config.web.ts
```

## 5. 构建 Web 产物（发布/验证用）

```bash
CHATBOX_BUILD_PLATFORM=web npx electron-vite build
# 产物在 release/app/dist/renderer/
# 低内存环境（3.9GB 沙箱）需: NODE_OPTIONS="--max-old-space-size=2560"
```

## 6. 类型检查（提交前必做）

```bash
node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit
# 必须 0 错误
```

## 7. 代码地图（接手必读）

```
src/renderer/modules/        ★ 全部自研功能
├── types.ts                WorldBookEntry / CharacterCard / ModFolder 等领域类型
├── storage.ts              官方存储键封装（web=IndexedDB / mobile=SQLite，逻辑一致）
├── store.ts                数据 CRUD/备份/日志/设置（Jotai atoms，官方存储后端）
├── prompt.ts               世界书/人物卡提示词注入（关键词命中 → ## World Book / ## Character Cards）
├── session.ts              会话级绑定（settings.worldBookIds / characterCardIds）
├── analyze.ts              长文分析（分块→提取→合并）
├── auto-update.ts          自动剧情更新（TanStack Query 响应式订阅）
├── novel.ts                小说分章/续写
├── export.ts               导出（官方 exporter）
├── migration.ts            v48 localStorage 数据迁移（幂等）
├── index.ts                入口 initChatboxMod()（在 src/renderer/index.tsx 调用）
└── ui/ChatboxModPage.tsx   管理界面 /settings/mod（6 Tab）

官方侵入点（3 处，带 [Chatbox Mod] 注释，勿删）：
├── packages/chatbox-core/src/domain/settings/settings-schema.ts  → +worldBookIds/characterCardIds（zod optional）
├── src/renderer/stores/session/agent-harness.ts                  → instructions 组装链插注入段（动态 import）
└── src/renderer/index.tsx + routes/settings/route.tsx            → 初始化 + 导航项
```

## 8. 接力规则（重要）

1. **改动范围**：功能只改 `modules/`；接官方机制才动 3 个侵入点，保留注释
2. **存储**：数据一律走官方存储（storage.ts），禁止 localStorage
3. **提交前**：tsc 0 错误 + commit 格式 `类型: 中文描述`（feat/fix/refactor/docs/ci/perf）
4. **每轮聚焦 1-3 个需求**，不要堆量
5. **发布**：push main 自动触发 CI（构建→签名→Release），15-20 分钟出可装 APK
6. **签名红线**：密钥 `android/keystore/chatbox-mod.keystore`（密码 chatbox123，alias chatbox-mod），指纹 `aa46319b...`，**换密钥=用户丢数据**
7. 完整规则文档见仓库根 `README.md` 顶部（官方 README 在下方，勿动）

## 9. 常见坑

| 现象 | 原因/解法 |
|---|---|
| 构建 OOM / Killed | 沙箱内存 3.9GB，加 `NODE_OPTIONS="--max-old-space-size=2560"` |
| 沙箱报"负载较高"拒绝命令 | 临时负载保护，等 1-5 分钟重试，重活前台跑 |
| pnpm install 超时 | 换镜像或 ELECTRON_SKIP_BINARY_DOWNLOAD=1 |
| tsc 报错集中在侵入点 | 官方类型变化，按 `[Chatbox Mod]` 注释定位修复 |
| 状态栏遮挡 | Android 15 edge-to-edge，`values-v35/styles.xml` + CI 注入已处理，勿删 |
