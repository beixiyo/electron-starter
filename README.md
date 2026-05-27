# Electron Mono-Repo 模板

## 系统要求

| 功能 | 最低 macOS 版本 | 说明 |
|------|----------------|------|
| 会议检测（audio-monitor） | 14.2 Sonoma | Core Audio Taps API |
| 录音 — 系统音频 | 14.0 | ScreenCaptureKit |
| 录音 — 麦克风 | **15.0** Sequoia | `SCStreamConfiguration.captureMicrophone` |

> Windows / Linux 不涉及 native 二进制，相关功能静默跳过

---

## Env 配置

https://cn.electron-vite.org/guide/env-and-mode

- `packages/electron/env/.env.development`
- `packages/electron/env/.env.production`

```bash
# Electron Env
VITE_ELECTRON_API_BASE_URL=xxx
VITE_ELECTRON_WS_BASE_URL=xxx

VITE_ELECTRON_APPLE_CLIENT_ID=xxx
VITE_ELECTRON_APPLE_REDIRECT_URI=xxx
VITE_ELECTRON_APPLE_SCOPE=xxx
VITE_ELECTRON_APPLE_STATE=xxx

VITE_ELECTRON_GOOGLE_CLIENT_ID=xxx
VITE_ELECTRON_GOOGLE_REDIRECT_URI=xxx


# Web Env
VITE_WEB_API_BASE_URL=xxx
VITE_WEB_WS_BASE_URL=xxx

VITE_WEB_APPLE_CLIENT_ID=xxx
VITE_WEB_APPLE_REDIRECT_URI=xxx
VITE_WEB_APPLE_SCOPE=xxx
VITE_WEB_APPLE_STATE=xxx

VITE_WEB_GOOGLE_CLIENT_ID=xxx
VITE_WEB_GOOGLE_REDIRECT_URI=xxx


# ASR Env
MAIN_VITE_ASR_APPID=xxx
MAIN_VITE_ASR_TOKEN=xxx
MAIN_VITE_ASR_CLUSTER=xxx
```

---

## 启动开发

```bash
pnpm i
pnpm build

# macOS：编译 Swift native 二进制（audio-monitor / audio-recorder / fn-listener / focus-check）
bash packages/app/scripts/build-native.sh

cd packages/electron
pnpm dev
```

VSCode 开发直接按下 **F5**

---

## Native 二进制

`packages/app/resources/` 下有多个 Swift 源码，通过统一脚本编译为 Universal Binary（arm64 + x86_64）：

```bash
bash packages/app/scripts/build-native.sh
```

| 二进制 | 源码 | 功能 |
|--------|------|------|
| `audio-monitor` | `audio-monitor.swift` | 轮询 Core Audio，检测哪些进程正在使用音频设备 |
| `audio-recorder` | `audio-recorder.swift` | ScreenCaptureKit 录制系统音频 + 麦克风，stdin/stdout JSON 通信 |
| `fn-listener` | `fn-listener.swift` | 监听 Fn 键事件 |
| `focus-check` | `focus-check.swift` | 检查前台应用焦点状态 |

所有二进制通过 `NativeBridge` 类（`main/native-bridge.ts`）统一管理生命周期和事件通信。

> 产物（无扩展名的二进制文件）已在 `.gitignore` 中排除，每次拉取后需重新编译

---

## 错误排查

### node-gyp: `No module named 'distutils'`

Python 3.12+ 移除了内置的 `distutils` 模块，导致旧版 `node-gyp`（如 `@electron/rebuild` 内置的 v9.x）编译原生模块时报错：

```
ModuleNotFoundError: No module named 'distutils'
```

**修复方式**（按系统选择）：

```bash
# macOS (Homebrew)
brew install python-setuptools

# 其他系统
pip3 install setuptools
```

---

## 打包

```bash
# Windows bug 必须全局安装
npm i -g electron-builder@25.1.8

# 打包产物在 packages/electron/dist
pnpm -F electron build:win
pnpm -F electron build:mac
```