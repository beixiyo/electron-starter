# packages/app — Electron 桌面应用

> macOS 原生能力 + React 前端的 Electron 应用，包含全局快捷键、文本焦点检测、媒体捕获、语音识别等功能

---

## 技术栈

| 层 | 技术 |
|---|---|
| 构建 | electron-vite 6-beta + Vite 8 |
| 主进程 | Electron 38 + TypeScript（Node.js target） |
| 渲染进程 | React 19 + TypeScript（浏览器 target） |
| 样式 | Tailwind CSS 4 |
| 路由 | @jl-org/react-router（文件路由自动生成） |
| 数据获取 | @tanstack/react-query |
| 动画 | motion/react |
| 国际化 | i18next + react-i18next |
| 包管理 | pnpm（monorepo 根目录） |
| 任务编排 | Nx 22 |

---

## 目录结构

```
packages/app/
├── main/              # Electron 主进程
│   ├── index.ts       # 应用入口
│   ├── fn-listener/   # macOS Fn 键监听（Swift 子进程管理）
│   ├── window-manager/# 窗口生命周期管理
│   ├── shortcuts/     # 全局快捷键（普通/长按/双击）
│   ├── media/         # 媒体捕获权限与工具
│   ├── selection/     # 文本选区功能
│   ├── utils/         # logger、error-handler、paste-text
│   └── api/           # 外部 API（ASR 语音识别）
│
├── preload/           # Context Bridge（暴露 window.$ipc）
│
├── renderer/          # React 前端
│   ├── router/        # 文件路由
│   ├── store/         # 全局状态（user）
│   ├── views/         # 页面组件（login / recorder）
│   ├── locales/       # i18n 翻译文件（zh-CN / en-US）
│   ├── api/           # HTTP 客户端实例
│   └── [*.html/tsx]   # 多窗口入口（voiceIme, selection, screenshot…）
│
├── ipc/               # IPC 通信层
│   ├── core/          # IPC 框架定义（main.ts / renderer.ts / types.ts）
│   ├── register.ts    # 统一注册所有 handlers
│   ├── listeners/     # 事件监听（fn / hold / oauth / screenshot…）
│   └── services/      # IPC 服务（media / window / screenshot / selection）
│
├── shared/            # 主进程与渲染进程共享代码
│   ├── constants/     # 快捷键、协议、Fn 键等常量
│   ├── ipc-events/    # IPC 事件名常量
│   ├── types/         # TypeScript 类型（window / media / oauth）
│   ├── window-config/ # 各窗口类型的配置（WINDOW_CONFIGS）
│   └── renderer/      # 渲染进程间通信事件
│
├── resources/         # 原生二进制（Swift 编译产物，已 gitignore）
│   ├── fn-listener    # Fn 键监听二进制
│   ├── fn-listener.swift
│   ├── focus-check    # 焦点检测二进制
│   └── focus-check.swift
│
├── scripts/           # 构建脚本
│   ├── build-fn-listener.sh
│   └── build-focus-check.sh
│
├── docs/              # 功能文档（必读）
│   ├── fn-key.md      # Fn 键监听原理与 API
│   └── focus-check.md # 文本焦点检测原理与 API
│
└── env/               # 环境变量
    ├── .env.development
    └── .env.production
```

---

## 开发命令

```bash
# 在 monorepo 根目录执行
pnpm dev            # 启动开发（等价 nx run app:dev）

# 在 packages/app 目录执行
pnpm typecheck      # 检查全部 TS 类型
pnpm typecheck:node # 仅检查 main/preload
pnpm typecheck:web  # 仅检查 renderer

# 编译 macOS 原生二进制（首次 clone 或 Swift 改动后必须执行）
pnpm build:fn-listener   # → resources/fn-listener
pnpm build:focus-check   # → resources/focus-check
```

---

## 路径别名

> 定义于 `electron.vite.config.ts`，TypeScript 中通过 `tsconfig.node.json` / `tsconfig.web.json` 识别

| 别名 | 实际路径 |
|---|---|
| `@shared` | `./shared` |
| `@main` | `./main` |
| `@ipc` | `./ipc` |
| `http-api` | `../http-api/src` |

工作区包（`comps`, `hooks`, `utils`, `config`, `styles`, `i18n`）通过 pnpm workspace 链接，直接按包名导入

---

## 多窗口架构

应用有多个独立窗口，每个窗口对应独立的 HTML 入口：

| 窗口 | HTML 入口 | 用途 |
|---|---|---|
| 主窗口 | `renderer/index.html` | 登录 + 录制主界面 |
| Voice IME | `renderer/voice-ime.html` | 语音输入法 |
| Selection | `renderer/selection.html` | 文本选区操作 |
| Screenshot | `renderer/screenshot.html` | 截图标注 |
| Shortcut Test | `renderer/shortcut-test.html` | 快捷键调试面板 |

窗口配置集中在 `shared/window-config/constants.ts`（`WINDOW_CONFIGS`），**不要在主进程和渲染进程之间重复定义窗口参数**

---

## IPC 通信规范

IPC 分两层，遵循以下分工：

- **`ipc/listeners/`** — 事件驱动（Fn 键、hold、oauth 等），主进程向渲染进程推送
- **`ipc/services/`** — 请求-响应（media、window、screenshot、selection），渲染进程发起调用

**新增 IPC 能力的步骤：**

1. 在 `shared/ipc-events/` 定义事件名常量
2. 在 `ipc/services/<name>/api.ts` 定义 API 类型
3. 在 `ipc/services/<name>/handlers.ts` 实现主进程逻辑
4. 在 `ipc/services/<name>/register.ts` 注册 handlers
5. 在 `ipc/register.ts` 调用注册函数
6. 在 `preload/index.ts` 通过 Context Bridge 暴露给渲染进程（`window.$ipc`）

**渲染进程通过 `window.$ipc.xxx` 调用，不要直接使用 `ipcRenderer`。**

---

## macOS 原生功能

> 详见 `docs/fn-key.md` 和 `docs/focus-check.md`，下手前必读

### Fn 键监听（fn-listener）

- 通过 Swift 子进程（IOHIDManager）独立监听 HID 层，绕过 Electron 的按键拦截限制
- 主进程管理子进程生命周期，通过 stdout 协议接收事件：`FN_DOWN` / `FN_UP` / `FN_COMBO_<key>`
- 300ms 状态机支持三种模式：**Hold**（长按）/ **DoublePress**（双击）/ **Combo**（组合键）
- 代码入口：`main/fn-listener/core.ts`（子进程管理）、`main/fn-listener/shortcuts.ts`（状态机）
- **注意 50ms 缓冲**：HID 事件存在时序抖动，详见 `docs/fn-key.md`

### 文本焦点检测（focus-check）

- 通过 Swift 子进程（Accessibility API / AXUIElement）一次性检测当前是否有文本输入焦点
- 与 fn-listener 不同，focus-check 是**一次性调用**，不常驻
- 典型场景：Voice IME 触发时判断是否直接注入文本
- 代码入口：`main/focus-check.ts`

**两个 Swift 二进制都在 `resources/` 下，已 gitignore。** 首次 clone 必须手动编译：

```bash
pnpm build:fn-listener
pnpm build:focus-check
```

---

## 权限要求（macOS）

应用需要以下 macOS 系统权限，在 `electron-builder.yml` 和 `build/entitlements.mac.plist` 中声明：

| 权限 | 用途 |
|---|---|
| 辅助功能（Accessibility） | 文本焦点检测、文本注入 |
| 输入监控（Input Monitoring） | Fn 键全局监听 |
| 摄像头 | 视频录制 |
| 麦克风 | 音频录制 / 语音识别 |
| 文档/下载文件夹 | 文件保存 |

---

## 构建与打包

```bash
# 完整构建（编译 TS + 打包资源）
pnpm build

# 跨平台打包
pnpm build:mac
pnpm build:win
pnpm build:linux

# 解包模式（调试打包结构）
pnpm build:unpack
```

构建产物：
- `out/` — TypeScript 编译结果（`electron-vite build` 输出）
- `dist/` — 平台安装包（`electron-builder` 输出）

---

## 环境变量

环境变量文件在 `env/` 目录，不同环境分别加载：

- `env/.env.development` — 开发环境（API 地址、WS 地址）
- `env/.env.production` — 生产环境

**私密配置（API Key、认证信息）不得硬编码，放入 env 文件并加入 .gitignore。**

---

## 代码规范

- **无分号、两格缩进、单引号**（遵循项目根 ESLint 配置 `@antfu/eslint-config`）
- **具名导出**，避免 `export default`，通过 `index.ts` 统一导出
- **类型定义放在文件底部**，不影响代码阅读
- **主进程代码**（`main/`, `preload/`）使用 CommonJS 输出（electron-vite 自动处理），但源码写 ESM
- **共享代码**（`shared/`）不能引入主进程或渲染进程专用模块（如 `electron`, `react`）

---

## 常见陷阱

1. **Swift 二进制未编译**：clone 后忘记运行 `pnpm build:fn-listener` / `pnpm build:focus-check`，运行时子进程启动失败
2. **窗口配置散落**：窗口参数应统一在 `shared/window-config/constants.ts` 定义，不要在多处硬编码
3. **直接使用 ipcRenderer**：渲染进程应通过 `window.$ipc` 访问，`ipcRenderer` 未通过 Context Bridge 暴露
4. **主进程引入渲染进程模块**：`shared/` 是唯一可以安全共用的目录，`renderer/` 内容不能在主进程中导入
5. **Fn 键 combo 时序**：HID 层有 50ms 抖动，处理 Combo 事件时参考 `docs/fn-key.md` 的缓冲方案，不要假设事件严格有序
