# 增量构建与交付复盘（V16 · 2026-10-07；V17.3 补丁 2026-10-07）

> **⚠️ 本文件为「每次构建前必读」（强制流程）**：任何一次 renderer 构建 / 重打包 / 签名 / 交付，动手前必须先完整通读本文（尤其「固化纪律」与「重打包参考命令」两节），并逐项执行六查清单；违反即视为流程事故。接手本仓库的 AI（或开发者）在构建交付前必须阅读并遵守本文。

---

## 一、交付流程（当前标准路径）

```
① 改代码（仅 src/renderer/，不动 android/）
        ↓
② pnpm run mobile:sync:android —— 移动端唯一正确入口（注入 CHATBOX_BUILD_TARGET=mobile_app + CHATBOX_BUILD_PLATFORM=android 后 build:renderer；CHATBOX_NO_MINIFY=1 仅应急，常规开压缩） ~11min
        ↓
③ npx cap sync android（拷贝网页产物进 assets） ~1min
        ↓
④ 重打包：非 public 条目从基底 APK 字节级复制 + 替换 assets/public/
        ↓
⑤ zipalign -f -p 4 → apksigner 用 v48 密钥签名
        ↓
⑥ 六查验证（含 CHATBOX_BUILD_TARGET="mobile_app" 产物断言）→ 交付
```
```

**全量构建（gradle assembleRelease）仅在以下情况使用**：
- 动了原生壳（Java 插件 / 图标 / 权限 / 应用名 / versionCode / 签名配置）
- 首次构建（无基底 APK）
- 正式分发 / 存档基准

---

## 二、V16 发现的问题与根因（按发生顺序）

### 1. 后台句柄丢失 → 误判进程死亡 → 重复启动构建

**现象**：TaskOutput 超时返回 "No task found"，误判构建失败。
**后果**：删除了运行中构建的输出文件；随后启动了第二个构建 → **双 esbuild 并发** → CPU 峰值翻倍 → 沙箱负载保护触发 30+ 分钟，期间所有工具调用被拒。
**教训**：
- 句柄丢失 ≠ 进程死亡，先 `ps aux | grep esbuild` 查进程再决定
- **绝不删除运行中进程的输出文件**
- **同一构建绝不启动两次**

### 2. 密钥文件用错

**现象**：签名报 `keystore password was incorrect`。
**根因**：使用了 `apk_delivery/chatbox-mod.keystore`（早期废钥，密码不同）；正确密钥在 `v48-keys/签名密钥/chatbox-mod.keystore`。
**教训**：
- 用 `keytool -list -storepass <pw>` **先验指纹**再签名
- 唯一可信密钥：`v48-keys/签名密钥/chatbox-mod.keystore`（SHA-256 指纹 `aa46319b85dc12aef993892fd4287af00951280ea0ee904ee8c716bbccd6ffaf`，别名 `chatbox-mod`，密码 `chatbox123`）

### 3. 重打包把 native 库压缩了（真·安装失败根因）

**现象**：真机报「安装文件错误(-2)」。
**根因**：`zip -r -X` 默认把全部条目 Deflate 压缩，包括 `lib/*/libsqlcipher.so`（4 ABI 共 19MB）。Android PackageManager 硬性要求 native 库**必须 STORED（不压缩）+ 对齐**，压缩即 `INSTALL_FAILED_INVALID_APK`。
**关键认知**：**zip 自检 / 签名验证全过 ≠ 真机能装**——安装器有独立于签名校验的 zip 语义校验。
**教训**：重打包时 `lib/*.so`、`assets/dexopt/*` 必须保持 STORED。

### 4. zip 重写残留结构差异（-124 嫌疑）

**现象**：修复 .so 压缩后第二版仍报「该安装包与您的系统不兼容(-124)」。
**根因**：虽然 .so 恢复 Stored，但 zip 重写使其 `version made by`（0.0 → 2.0）、时间戳等属性与基底不一致，MIUI 安装器可能因结构差异拒绝。
**最终解法**：**非 public 条目从基底 APK 字节级原样复制**（`ZipFile.writestr(info, src.read(fn))` 保留全部 entry 属性），只替换 `public/`。.so 属性与基底完全一致（`0.0 unx ... stor`），真机安装成功。
**教训**：能复制的绝不重写；重打包追求"最小改动"。

### 4b. 网页产物路径写错（V17 · 新代码"不生效"）

**现象**：用户截图设置页，官方备份勾选项仍是 4 项，新增的「创作数据」项没出现；但代码、构建产物、cap sync 产物都确认含新功能。
**根因**：基底 APK 的网页产物在 **`assets/public/`**（Android 原生 assets 路径），重打包脚本却按旧认知跳过了 `public/`（无 assets 前缀）并把新产物写入 `public/`。结果 APK 里**两套 public 并存**：基底的旧 `assets/public/`（491 个文件，WebView 实际加载它）+ 新 `public/`（WebView 不加载）——等于交付了 V16 旧 UI。**zip 里文件在 ≠ WebView 加载它**。
**修复**：重打包时剔除基底 `assets/public/*` 与历史残留 `public/*`，新产物写入 `assets/public/`；交付前用 `unzip -p <apk> assets/public/js/index.*.js | grep <新功能特征串>` 验证。
**教训**：**APK 内路径必须跟 WebView 实际加载路径（assets/ 前缀）一致**；交付验证不能只验"新代码在不在"，要验"新代码在不在 WebView 加载的路径"。

### 4c. 强制中文逻辑未延续（V17 · 界面变英文）

**现象**：用户覆盖安装 V17 后设置页全英文（官方项英文、我们硬编码的中文项不变），用户强烈不满（"有没有说过我不要英文"）。
**根因**：早期项目（2026-09-17 XM02 记录）明确要求「语言模块强制 zh-Hans」；迁移到官方 TS 源码 fork 时该强制逻辑丢失，`bootstrapRenderer.ts` 改为 `i18n.changeLanguage(settings.language)` 跟随持久化设置——设置/系统语言为英文时界面即英文。硬编码中文项不受影响，恰好成为判断依据（官方项英文 + 自定义项中文 = i18n 语言丢了）。
**修复**：`bootstrapRenderer.ts` 强制 `void i18n.changeLanguage('zh-Hans')`（不跟随 settings.language）；偏好固化「界面语言必须简体中文，不接受英文」。
**教训**：**用户早期明确的产品级约束必须随仓库迁移延续**，接手时先核对「历史硬约束清单」；涉及语言/设置初始化的改动不得悄悄回退强制逻辑。

### 4d. 移动端构建未注入 mobile_app target（V17.3 · 数据「消失」+ 平台错乱）

**现象**：用户覆盖安装 V17.1~V17.3 后（尤其 V17.3）会话/世界书/人物卡数据全部「消失」；同时移动端本应隐藏的「Keyboard Shortcuts」设置入口出现在安卓设置页（安卓无物理键盘，无法使用）。用户反问「之前开发过程中不是挺好的吗」——开发/测试在桌面/Web 环境有物理键盘、数据在测试环境，掩盖了真机问题。
**根因**：交付 Android 的 renderer 构建直接用了 `npx cross-env CHATBOX_ELECTRON_VITE_TARGET=renderer electron-vite build`（未注入 `CHATBOX_BUILD_TARGET`），产物 `const CHATBOX_BUILD_TARGET="unknown"`。`createPlatform()` 里 `CHATBOX_BUILD_TARGET === 'mobile_app'` 分支不命中、`window.electronAPI` 不存在 → 落到 **WebPlatform**（`platform.type='web'`）→ 数据读写走 **localStorage**，而正确移动端（MobilePlatform）数据在 **SQLite**（`chatbox.db` / `chatbox-session-meta.db`，app 私有目录）。于是：① SQLite 旧数据完全读不到（文件未删，只是不读）→ 用户看数据「全没了」；② `platform.type === 'mobile'` 判定失效 → 设置菜单 Keyboard Shortcuts 入口错误显示。
**证据（APK 产物直查）**：基底 `fork版_202610061721.apk` 主 bundle 含 `const CHATBOX_BUILD_TARGET="mobile_app"`；V17.1/V17.2/V17.3 均含 `const CHATBOX_BUILD_TARGET="unknown"`。正确命令一直存在：`package.json:64 "mobile:sync:android": "cross-env CHATBOX_BUILD_TARGET=mobile_app CHATBOX_BUILD_PLATFORM=android pnpm run build:renderer && pnpm run delete-sourcemaps && npx cap sync android"`——未按它执行。
**后果**：三版交付（V17.1/V17.2/V17.3）全部以 WebPlatform 运行；V17.1 验收只看功能未触发数据检查，错误被带进后续版本。
**修复**：renderer 构建必须走 `pnpm run mobile:sync:android`（注入 `CHATBOX_BUILD_TARGET=mobile_app CHATBOX_BUILD_PLATFORM=android`）；**交付前六查新增第 6 项**：`unzip -p <apk> assets/public/js/index.*.js | grep -c 'CHATBOX_BUILD_TARGET="mobile_app"'` 必须 ≥1。
**教训**：**壳层五查（zip/对齐/签名/manifest/.so）全部通过 ≠ JS 产物平台正确**——平台判定常量是构建时注入的，必须验证产物而非仅验证壳；移动端交付必须走仓库已定义的移动端构建命令，禁止裸 electron-vite build。

### 5. NO_MINIFY 的交付副作用

**现象**：为降沙箱负载关闭 JS 压缩，主 bundle 15.3MB，APK 体积 24.7MB→46MB。
**影响**：用户网络仅 27-30KB/s，大文件下载损坏概率显著上升（曾误判为网络问题）。
**教训**：降负载手段要考虑交付副作用；NO_MINIFY 仅应急，**交付后应补压缩版**。

### 4e. 沙箱 4GiB 内存 cgroup 下的构建失败与成功模式（10-08 重建备份扩展复盘）

**背景**：用户裁决作废 V17 全线后，要求在基底 `fork版_202610061721.apk` 上重做「备份扩展」。重建时沙箱 cgroup 内存上限 `memory.max=4294967296`（4GiB），容器约每 20-66 分钟周期重启。

**失败模式（前 6 次尝试）**：
1. `CHATBOX_NO_MINIFY=1`：转译/渲染阶段内存峰值 **3968MB 撞 4GiB 线**被 cgroup OOM 杀（进程无声消失、无内核 oom 日志、load 飙到 14+ thrash）——NO_MINIFY 大 bundle 写盘内存峰值最高，**此模式下必死**
2. 默认压缩版：内存峰值 3211MB（不撞线），但**渲染阶段（rendering chunks...）thrash 卡死**（对象图贴 4G 线 + cgroup 共享配额被挤压 → 渲染 40min+ 不写盘），随后被沙箱周期重启或进程保护杀掉
3. `NODE_OPTIONS=--max-old-space-size=2048` 无效：峰值内存来自 **esbuild worker（Go 进程）**，不受 node 堆限制；仍撞线
4. `taskset -c 0 nice -n 19`（单核+最低优先级）：无本质改善
5. 额外坑：`pnpm run mobile:sync:android` 链内 `delete-sourcemaps` 脚本引用 `./.erb/scripts/delete-source-maps-runner.js`（**该文件不存在**，实际文件是 `delete-source-maps.js`）→ `build:renderer && delete-sourcemaps && cap sync` 的 `&&` 短路，**cap sync 不执行**——但**产物已完整生成**，只是没同步到 android assets

**成功模式（第 7 次，11 分钟完成）**：
- 前提：等待沙箱**完全空闲**（`load <1`、可用内存 ≥3.5G）后再启动；沙箱周期重启后立即启动有最大窗口
- 关键改动：**临时移除 `electron.vite.config.ts` 中 renderer 的 `manualChunks`**（改为 `manualChunks: undefined`）——消除 `Circular chunk: vendor-ui -> vendor-ai -> vendor-ui` 渲染死循环/卡死，渲染阶段飞速完成；**构建成功后立即还原配置**
- 使用默认压缩（不开 NO_MINIFY）
- 产物实际输出目录：**`release/app/dist/renderer/`**（`outDir: isProduction ? 'release/app/dist/renderer'`，不是 `out/renderer`！）
- 链中断后手动补：把 `release/app/dist/renderer/*` 整体作为 `assets/public/*` 重打包（Python 字节级复制脚本）+ zipalign + v48 签名 + 六查

**六查第 6 项的精确写法（防误报）**：`unzip -p <apk> "assets/public/js/index.*.js"` 通配符可能匹配到**非主 bundle**（如 `index.6OzrIVh1.js` 366B 小 chunk），断言会误报失败/通过。正确做法：先读 `assets/public/index.html` 的 `src="./js/index.XXX.js"` 取**精确主 bundle 名**，再对其断言 target。

**教训**：① 4GiB cgroup 下 NO_MINIFY 必死，压缩版+低峰+临时去 manualChunks 是可行路径；② 产物在 `release/app/dist/renderer`；③ `delete-sourcemaps` 脚本缺失导致链中断属常态，手动同步产物即可；④ 六查 target 断言必须用 index.html 引用的精确主 bundle 名。

---

## 三、固化纪律（铁律）

1. **单进程构建**：句柄丢失 ≠ 进程死亡；先查进程再决定；不删运行中产物；不重复启动
2. **重打包铁律**：非网页条目从基底字节级复制；`.so` / `dexopt` 必须 STORED；**网页产物路径 = `assets/public/`**（不是 `public/`）：剔除基底 `assets/public/*`、写入 `assets/public/`，交付前验证 APK 内该路径含新功能特征串
3. **密钥唯一**：`v48-keys/签名密钥/chatbox-mod.keystore`（指纹 aa46319b85）；用前 keytool 验指纹
4. **移动端构建命令（V17.3 新增）**：交付 Android APK 的 renderer 构建**必须**用 `pnpm run mobile:sync:android`（内部注入 `CHATBOX_BUILD_TARGET=mobile_app CHATBOX_BUILD_PLATFORM=android`）；**禁止裸 `electron-vite build` / 裸 `npx cross-env ... electron-vite build` 交付移动端**——不注入 target 时产物 `CHATBOX_BUILD_TARGET="unknown"`，运行时走 WebPlatform→localStorage，读不到 SQLite 旧数据（用户数据「消失」）且平台判定错乱（移动端应隐藏入口错误显示）
5. **交付前六查**：
   - `unzip -t <apk>` → zip 完整性
   - `zipalign -c -p 4 <apk>` → 对齐（需在签名后验证）
   - `apksigner verify <apk>` → 签名有效
   - `aapt dump badging <apk>` → manifest 可解析、native-code 完整
   - `unzip -v <apk> | grep .so` → 全部 Stored
   - **`unzip -p <apk> assets/public/js/index.*.js | grep -c 'CHATBOX_BUILD_TARGET="mobile_app"'` → 必须 ≥1**（V17.3 新增：构建 target 正确注入，防数据层错位）
6. **体积默认压缩**：常规构建开 minify；NO_MINIFY 仅应急并尽快补压缩版
7. **环境纪律**：构建前查残留进程与负载；错峰运行（renderer 与 gradle 绝不并发）；沙箱重启后先 `gradlew help` 预热验缓存

### 正确构建命令（V17.3 新增，替代裸 electron-vite build）

```bash
# 移动端 Android（唯一正确入口）：构建 + 删 sourcemap + cap sync 一步完成
pnpm run mobile:sync:android
# 等价手拆：
#   cross-env CHATBOX_BUILD_TARGET=mobile_app CHATBOX_BUILD_PLATFORM=android pnpm run build:renderer
#   pnpm run delete-sourcemaps
#   npx cap sync android
```

---

## 四、重打包参考命令

```bash
# 非 public 字节级复制 + assets/public 替换（Python）
# 注意：网页产物路径是 assets/public/（Android 原生 assets），不是 public/！
python3 - <<'EOF'
import zipfile, os
with zipfile.ZipFile(base_apk, 'r') as src, zipfile.ZipFile(out, 'w') as dst:
    for info in src.infolist():
        fn = info.filename
        if fn.startswith('assets/public/') or fn.startswith('META-INF/') or fn.endswith('/'):
            continue
        dst.writestr(info, src.read(fn))  # 保留全部 entry 属性
    for root, dirs, files in os.walk(newpub):
        for f in files:
            full = os.path.join(root, f)
            rel = 'assets/public/' + os.path.relpath(full, newpub).replace(os.sep, '/')
            dst.write(full, rel, compress_type=zipfile.ZIP_DEFLATED)
EOF

# 对齐 + 签名
zipalign -f -p 4 in.apk aligned.apk
apksigner sign --ks v48-keys/签名密钥/chatbox-mod.keystore \
  --ks-pass pass:chatbox123 --key-pass pass:chatbox123 \
  --ks-key-alias chatbox-mod --out signed.apk aligned.apk
```

> 注意：重打包后签名（META-INF 由 apksigner 重写），**不得保留旧签名条目**；`androidx.tracing_tracing.version` 等 WARNING 可忽略。
