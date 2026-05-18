# Electron Mono-Repo 模板

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

cd packages/electron
pnpm dev
```

VSCode 开发直接按下 **F5**

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