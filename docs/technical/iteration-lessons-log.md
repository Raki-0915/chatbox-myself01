# 迭代教训日志（历次版本错误与根因 · 接手必读）

> 本文件按时间顺序固化本项目历次迭代中出现的**错误、根因与预防动作**，与 `build-delivery-playbook.md`（完整复盘细节）互为补充。
> **规则**：每轮交付出现新问题，必须在本文件追加一条记录（时间 / 版本 / 错误 / 根因 / 预防），并在 README 铁律区同步；已固化条目不删不改，只追加。

---

## 时间线总览

| 序号 | 时间 | 版本/事件 | 错误性质 |
|---|---|---|---|
| 1 | 10-02 | V1 构建 | 状态栏遮挡（edge-to-edge）、图标资源非法 |
| 2 | 10-03 | 归档期 | APK 二进制被 CRLF 转换损坏 |
| 3 | 10-03 | 导出功能 | 导出 base64 损坏、DocumentSaver 插件注册失败 |
| 4 | 10-07 | V16 增量交付 | 5 个问题（并发构建/删产物/密钥错/native 压缩/zip 结构） |
| 5 | 10-07 | V17 | 重打包路径写错 `public/`、强制中文未延续 |
| 6 | 10-07 | V17.3 | 构建未注入 `mobile_app` target → 数据「消失」+ 平台错乱 |
| 7 | 10-08 | 备份扩展重建 | 沙箱 4GiB OOM、NO_MINIFY 撞线、manualChunks 卡死 |
| 8 | 10-08 | 移动端提供商导入 | 残留产物误判、重复条目重打包、沙箱重启杀构建、限流静默 |

---

## 逐条详情

### 1. V1（10-02）：状态栏遮挡与图标资源
- **错误**：Android 15 edge-to-edge 导致顶栏被状态栏遮挡；自适应图标引用非法 split-vector 资源。
- **根因**：官方 CI 默认 edge-to-edge；Capacitor 模板残留非法 drawable。
- **预防**：构建后 `aapt dump badging` 验证；图标用 mipmap png；状态栏修复 commit `bdf9b8f` 已固化。

### 2. 归档期（10-03）：APK 二进制损坏
- **错误**：Git 提交时 `.apk` 未标记 binary，CRLF 转换损坏 APK（用户下载后无法安装/校验不一致）。
- **根因**：`.gitattributes` 缺少 `*.apk binary`。
- **预防**：`.gitattributes` 标记 `*.apk binary`（commit `183d706`）；归档后必须 clone/md5 校验与本地一致（README 3.5 节）。

### 3. 导出功能（10-03）：base64 损坏与插件注册
- **错误**：导出自定义文件名时报 `bad base-64`；DocumentSaver 原生插件两次注册失败。
- **根因**：导出串未按 UTF-8 处理 base64；插件注册时机（构建时/运行时）与 Capability 配置不匹配。
- **预防**：插件改动必须全量构建验证（纯 renderer 改动才可增量）；`fork版_202610030400`、`_202610030410` 已修复。

### 4. V16 增量交付（10-07）：五连错
1. **后台句柄丢失 → 误判进程死亡 → 重复启动构建**（并发构建互相踩输出）
2. **密钥文件用错**（多密钥并存时选错，签名指纹不符）
3. **重打包把 native 库压缩了**（`lib/*.so` 非 STORED → 真机安装失败，`-124` 错误）
4. **zip 重写残留结构差异**（重写 ZIP 后目录/对齐与原生不一致）
5. **NO_MINIFY 交付副作用**（体积暴增、慢网下载易损坏）
- **预防**：单进程构建（先 `ps` 再决定）、密钥唯一 + `keytool` 验指纹、`.so`/`assets/dexopt/*` 必须 STORED、体积默认压缩。细节见 playbook「二、V16」。

### 5. V17（10-07）：路径写错 + 语言回退
1. **重打包路径写错 `public/` 而非 `assets/public/`** → 新代码「不生效」（WebView 加载的是旧 assets，界面无新功能）。
2. **强制中文逻辑未延续** → 界面变英文（用户强烈不满）。
- **预防**：重打包必须剔除基底的 `assets/public/*` 并把新产物写入 `assets/public/`（Android 原生 assets），交付前验证 APK 内 `assets/public/js/index.*.js` 含新功能特征串；界面语言硬约束 = 简体中文（铁律 7）。细节见 playbook「4b / 4c」。

### 6. V17.3（10-07）：target 未注入 → 数据「消失」（最严重事故）
- **错误**：用裸 `electron-vite build` 构建移动端 renderer，未注入 `CHATBOX_BUILD_TARGET=mobile_app`，产物以 `"unknown"` 平台运行。
- **根因**：构建命令链缺少 target/平台环境变量注入。
- **后果**：`"unknown"` → WebPlatform → localStorage，SQLite 旧数据全部读不到（覆盖安装后用户数据「消失」）+ 移动端应隐藏的 Keyboard Shortcuts 入口错误显示。
- **预防**：**移动端构建唯一正确入口 = `pnpm run mobile:sync:android`**（内部注入 `CHATBOX_BUILD_TARGET=mobile_app CHATBOX_BUILD_PLATFORM=android`）；六查新增产物 target 断言（铁律 5）。细节见 playbook「4d」。

### 7. 备份扩展重建（10-08）：沙箱 4GiB 内存
- **错误**：7 次构建尝试 6 次失败——NO_MINIFY 峰值 3968MB 撞 cgroup 4GiB 被静默 OOM；压缩版渲染期被沙箱周期重启（20-66min 窗口）扼杀；`NODE_OPTIONS` 限制 node 堆无效（峰值来自 esbuild Go worker）。
- **成功模式**：低负载窗口（load<1、可用≥3.5G）+ 临时移除 renderer `manualChunks`（消除 Circular chunk 渲染卡死，构建后还原）+ 默认压缩 → 约 11min 完成。
- **预防**：铁律 8（禁 NO_MINIFY、临时去 manualChunks、低峰启动、产物在 `release/app/dist/renderer/`、`delete-sourcemaps` 链中断常态）。细节见 playbook「4e」。

### 8. 移动端提供商导入（10-08）：本次新增四坑
1. **残留产物误判（最危险）**：构建进程被沙箱重启杀死后，`release/app/dist/renderer/` 留下**被杀前已写盘的残留产物**（index.html/js 齐全、日志无报错）——误判「构建成功」，但产物是**旧代码**（新功能字符串全部 0 命中）。**只看「日志无报错 + 文件存在」会交付一个没有新功能的 APK**。
2. **重复条目重打包坑**：重打包脚本「先全复制基底、再追加同名新条目」→ zip 出现 **Duplicate name**（安装行为不定）。正确：**跳过将被覆盖的 `assets/public/*` 条目、保留基底独有文件（cordova.js / cordova_plugins.js 等），再写入新产物**。
3. **沙箱重启杀构建**：后台任务句柄在沙箱重启后消失（`No task found`）；构建 ~6-11min 必须在上次重启后窗口前段启动。
4. **构建期工具请求被限流**：构建渲染期所有工具请求报「沙箱当前负载较高」——应**静默长等（Wait 5-10min 间隔）再探测**，不要高频重试消耗窗口。
- **额外教训**：查询产物路径前先确认当前目录（`release/` 在 `chatbox-fork/` 子目录，父目录查询会误报「产物消失」）。
- **预防**：构建完成**立即**用新功能特征串断言产物（Python `count` 精确匹配，勿用 grep 前缀匹配如 `Import Provider Config` 会误中 `Import Provider Configuration`）；重打包后验证无重复条目；低峰启动 + 静默等待。

---

## 沉淀为铁律的映射

| 本日志条目 | 对应铁律（README） | 对应复盘（playbook） |
|---|---|---|
| 4（V16） | 铁律 1/2/3/6 | 二（1-5） |
| 5（V17） | 铁律 2/7 | 二（4b/4c） |
| 6（V17.3） | 铁律 4/5 | 二（4d） |
| 7（备份扩展） | 铁律 8 | 二（4e） |
| 8（移动端导入） | 铁律 5（产物断言）+ 新增 4f | 二（4f） |
