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

### Arch Linux: `libcrypt.so.1` 缺失（仅 electron-builder 26+）

electron-builder 26+ 内置的 fpm（Ruby 预编译）依赖 `libcrypt.so.1`，但 Arch Linux 已升级为 `libcrypt.so.2`，导致 deb/snap 打包失败：

```
ruby: error while loading shared libraries: libcrypt.so.1: cannot open shared object file
```

**修复**：安装兼容库（Arch 官方 core 仓库）：

```bash
sudo pacman -S libxcrypt-compat
```

> **注意**：electron-builder 25.x 使用旧版 fpm，不受此问题影响。

### electron-builder 26 + pnpm monorepo: `Cannot find module`

electron-builder v26 重写了模块收集器（纯 JS 替代旧 `app-builder` 二进制），对 pnpm monorepo 的 symlink 结构支持存在**已知 bug**（[#8986](https://github.com/electron-userland/electron-builder/issues/8986)、[#9654](https://github.com/electron-userland/electron-builder/issues/9654)），导致 ASAR 中缺失 node_modules，运行时报错：

```
Error: Cannot find module '@electron-toolkit/utils'
Error: Cannot find module 'uiohook-napi'
```

**修复**：降级到 electron-builder **25.1.8**（旧收集器能正确跟踪 pnpm symlink）：

```bash
pnpm -F app add -D electron-builder@25.1.8
```

---

## 打包

```bash
# 打包产物在 packages/app/dist/dist
pnpm -F app build:win
pnpm -F app build:mac
pnpm -F app build:linux
```