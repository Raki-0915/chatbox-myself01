# 增量构建与交付复盘（V16 · 2026-10-07）

> 本文记录 Chatbox Mod fork 在 V16 增量交付（章节列表 / 胶囊带名 / 起点章 / 取消生成 / 概述区域）过程中发现的问题、根因与固化纪律。接手本仓库的 AI（或开发者）在构建交付前必须阅读并遵守本文。

---

## 一、交付流程（当前标准路径）

```
① 改代码（仅 src/renderer/，不动 android/）
        ↓
② build:renderer（CHATBOX_NO_MINIFY=1 仅应急，常规开压缩） ~11min
        ↓
③ npx cap sync android（拷贝网页产物进 assets） ~1min
        ↓
④ 重打包：非 public 条目从基底 APK 字节级复制 + 替换 public/
        ↓
⑤ zipalign -f -p 4 → apksigner 用 v48 密钥签名
        ↓
⑥ 五查验证 → 交付
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

### 5. NO_MINIFY 的交付副作用

**现象**：为降沙箱负载关闭 JS 压缩，主 bundle 15.3MB，APK 体积 24.7MB→46MB。
**影响**：用户网络仅 27-30KB/s，大文件下载损坏概率显著上升（曾误判为网络问题）。
**教训**：降负载手段要考虑交付副作用；NO_MINIFY 仅应急，**交付后应补压缩版**。

---

## 三、固化纪律（铁律）

1. **单进程构建**：句柄丢失 ≠ 进程死亡；先查进程再决定；不删运行中产物；不重复启动
2. **重打包铁律**：非网页条目从基底字节级复制；`.so` / `dexopt` 必须 STORED；**网页产物路径 = `assets/public/`**（不是 `public/`）：剔除基底 `assets/public/*`、写入 `assets/public/`，交付前验证 APK 内该路径含新功能特征串
3. **密钥唯一**：`v48-keys/签名密钥/chatbox-mod.keystore`（指纹 aa46319b85）；用前 keytool 验指纹
4. **交付前五查**：
   - `unzip -t <apk>` → zip 完整性
   - `zipalign -c -p 4 <apk>` → 对齐（需在签名后验证）
   - `apksigner verify <apk>` → 签名有效
   - `aapt dump badging <apk>` → manifest 可解析、native-code 完整
   - `unzip -v <apk> | grep .so` → 全部 Stored
5. **体积默认压缩**：常规构建开 minify；NO_MINIFY 仅应急并尽快补压缩版
6. **环境纪律**：构建前查残留进程与负载；错峰运行（renderer 与 gradle 绝不并发）；沙箱重启后先 `gradlew help` 预热验缓存

---

## 四、重打包参考命令

```bash
# 非 public 字节级复制 + public 替换（Python）
python3 - <<'EOF'
import zipfile, os
with zipfile.ZipFile(base_apk, 'r') as src, zipfile.ZipFile(out, 'w') as dst:
    for info in src.infolist():
        fn = info.filename
        if fn.startswith('public/') or fn.startswith('META-INF/') or fn.endswith('/'):
            continue
        dst.writestr(info, src.read(fn))  # 保留全部 entry 属性
    for root, dirs, files in os.walk(newpub):
        for f in files:
            full = os.path.join(root, f)
            rel = 'public/' + os.path.relpath(full, newpub).replace(os.sep, '/')
            dst.write(full, rel, compress_type=zipfile.ZIP_DEFLATED)
EOF

# 对齐 + 签名
zipalign -f -p 4 in.apk aligned.apk
apksigner sign --ks v48-keys/签名密钥/chatbox-mod.keystore \
  --ks-pass pass:chatbox123 --key-pass pass:chatbox123 \
  --ks-key-alias chatbox-mod --out signed.apk aligned.apk
```

> 注意：重打包后签名（META-INF 由 apksigner 重写），**不得保留旧签名条目**；`androidx.tracing_tracing.version` 等 WARNING 可忽略。
