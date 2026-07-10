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
│   ├── shortcuts/     # 快捷键捕获与运行时（含 macOS Fn 子进程管理）
│   ├── audio-recorder/# 原生录音子进程桥接
│   ├── window-manager/# 窗口生命周期管理
│   ├── media/         # 媒体捕获权限与工具
│   ├── selection/     # 文本选区功能
│   ├── utils/         # logger、error-handler、paste-text
│   └── api/           # 外部 API（ASR 语音识别）
│
├── preload/           # Context Bridge（暴露 window.$ipc）
│
├── renderer/          # React 前端
│   ├── broadcast/     # 渲染进程间广播通信（renderer-only，基于 BroadcastChannel）
│   ├── router/        # 文件路由
│   ├── store/         # 全局状态（user）
│   ├── views/         # 页面组件（login / recorder）
│   ├── locales/       # i18n 翻译文件（zh-CN / en-US）
│   ├── api/           # HTTP 客户端实例
│   └── [*.html/tsx]   # 多窗口入口（voiceIme, selection, screenshot…）
│
├── ipc/               # IPC 通信层（contract-driven 架构）
│   ├── core/          # IPC 框架（contract.ts / service.ts / client.ts）
│   └── services/      # 各 IPC 服务（fn / hold / media / oauth / screenshot / selection / voice-ime / window…）
│
├── shared/            # 主进程与渲染进程共享代码（禁止引入 electron / react 等端专属模块）
│   ├── constants/     # 快捷键、协议、Fn 键等常量
│   ├── ipc-types/     # IPC 消息 payload 类型（screenshot / selection / voice-ime，主进程与渲染进程都用）
│   ├── types/         # TypeScript 类型（window / media / oauth）
│   └── window-config/ # 各窗口类型的配置（WINDOW_CONFIGS）
│
├── native/            # 平台原生源码
│   └── mac/           # macOS Swift helper 源码
│       ├── fn-listener.swift
│       ├── focus-check.swift
│       ├── audio-monitor.swift
│       └── audio-recorder.swift
│
├── resources/         # 运行时资源与原生编译产物
│   ├── icon.png
│   └── native/mac/    # macOS Swift 编译产物（已 gitignore）
│       ├── fn-listener
│       ├── focus-check
│       ├── audio-monitor
│       └── audio-recorder
│
├── scripts/           # 构建脚本
│   ├── build-native.sh       # 原生编译平台分发入口
│   └── native/
│       └── build-mac.sh      # macOS Swift helper 编译实现
│
├── docs/              # 功能文档（必读）
│   ├── fn-key.md      # Fn 键监听原理与 API
│   ├── focus-check.md # 文本焦点检测原理与 API
│   └── update/        # 应用自动更新（electron-updater）：机制、三档测试、发布托管
│
└── env/               # 环境变量
    ├── .env.example   # 模板（含更新发布 GCS 配置），复制为 .env 使用
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
pnpm build:native       # 默认编译 macOS native helper
pnpm build:native:mac   # 显式编译 macOS native helper
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

采用 **contract-driven** 架构，每个服务由三个文件组成，类型安全贯穿主进程与渲染进程：

| 文件 | 职责 |
|---|---|
| `contract.ts` | 定义 `IpcContract<InvokeSignatures, EventPayloads>` 类型，声明请求-响应方法签名和事件载荷 |
| `service.ts` | 主进程实现，调用 `createIpcService<Contract>(namespace, handlers)` 自动注册到 `ipcMain.handle()` |
| `client.ts` | 渲染进程客户端，调用 `createServiceClient<Contract>(namespace, methods)` 生成类型安全的调用代理 |

核心类型（`ipc/core/contract.ts`）：

- `IpcContract<H, E>` — 合并 invoke 方法与 event 推送的契约类型
- `ServiceHandlers<C>` — 自动为 handler 签名添加 `event` 参数
- `IpcEmitter<C>` — 主进程类型安全的事件发射器
- `IpcClient<C>` — 渲染进程合并请求方法 + 订阅方法的客户端类型

**服务加载方式：**

- **核心服务**（window / media / screenshot / selection）通过 `ipc/services/index.ts` 统一导入，在 `main/index.ts` 中 `import '@ipc/services'` 始终加载
- **按需服务**（fn / hold / oauth / voice-ime / focus / shortcut-test）在使用处直接导入 `service.ts`，按需注册

**新增 IPC 能力的步骤：**

1. 创建 `ipc/services/<name>/contract.ts`，定义 `IpcContract` 类型
2. 创建 `ipc/services/<name>/service.ts`，用 `createIpcService()` 实现并自动注册
3. 创建 `ipc/services/<name>/client.ts`，用 `createServiceClient()` 生成客户端
4. 在主进程入口或使用处导入 `service.ts`（核心服务加到 `ipc/services/index.ts`，按需服务在使用处导入）
5. 在 `preload/index.ts` 通过 Context Bridge 暴露客户端（`window.$ipc`）

**渲染进程通过 `window.$ipc.xxx` 调用，不要直接使用 `ipcRenderer`**

---

## 广播通信（Broadcast）

> 仅限 **renderer 进程**使用，基于浏览器原生 `BroadcastChannel` API，**不经过主进程**，适合多渲染进程间的轻量状态同步
> 代码位置：`renderer/broadcast/`（不在 `shared/`，因为含浏览器专属 API）

### 核心 API

```ts
import { createWindowBroadcast } from '../broadcast'   // 在 renderer 内相对路径导入

const bc = createWindowBroadcast<{ theme: string }>('theme-sync')
```

| 方法 / 属性 | 说明 |
|---|---|
| `bc.selfType` | 当前窗口类型（只读），从 URL `?windowType` query param 自动读取 |
| `bc.post(payload, to?)` | 发送消息；`to` 省略时广播到 **所有** 渲染窗口，传入 `WindowType[]` 则定向发送 |
| `bc.on(callback)` | 订阅消息，**自动过滤**掉定向给其他窗口的消息；返回取消订阅函数 |
| `bc.close()` | 关闭通道，释放底层 `BroadcastChannel` 资源 |

### 消息结构 `BroadcastMessage<T>`

```ts
type BroadcastMessage<T> = {
  payload: T          // 消息内容
  from: WindowType    // 发送方窗口类型
  to?: WindowType[]   // 目标列表；undefined = 全体广播
}
```

### 使用规则

1. **不可在主进程（main/preload）使用** —— `BroadcastChannel` 依赖 `window.location`，Node.js 环境会直接报错；跨进程通信请走 IPC 层
2. **通道名需全局唯一**：建议在 `shared/constants/` 统一定义字符串常量，避免散落
3. **订阅务必清理**：React 组件内用 `useEffect` 返回 `unsub`；泄漏会导致重复触发
4. **`selfType` 可能为 null**：若窗口 URL 没有 `?windowType` 参数，`post()` 发出的消息 `from` 字段为 `null`，发送定向消息前注意校验

---

## macOS 原生功能

> 详见 `docs/fn-key.md` 和 `docs/focus-check.md`，下手前必读

### Fn 键监听（fn-listener）

- 通过 Swift 子进程（IOHIDManager）独立监听 HID 层，绕过 Electron 的按键拦截限制
- 主进程管理子进程生命周期，通过 stdout 协议接收事件：`FN_DOWN` / `FN_UP` / `FN_COMBO_<key>`
- 300ms 状态机支持三种模式：**Hold**（长按）/ **DoublePress**（双击）/ **Combo**（组合键）
- Swift 源码：`native/mac/fn-listener.swift`
- 代码入口：`main/shortcuts/fn/core.ts`（子进程管理）、`main/shortcuts/fn/state-machine.ts`（状态机）
- **注意 50ms 缓冲**：HID 事件存在时序抖动，详见 `docs/fn-key.md`

### 文本焦点检测（focus-check）

- 通过 Swift 子进程（Accessibility API / AXUIElement）一次性检测当前是否有文本输入焦点
- 与 fn-listener 不同，focus-check 是**一次性调用**，不常驻
- 典型场景：Voice IME 触发时判断是否直接注入文本
- Swift 源码：`native/mac/focus-check.swift`
- 代码入口：`main/focus-check.ts`

**Swift 二进制都在 `resources/native/mac/` 下，已 gitignore。** 首次 clone 必须手动编译：

```bash
pnpm build:native
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

**私密配置（API Key、认证信息）不得硬编码，放入 env 文件并加入 .gitignore**

---

## 代码规范

- **无分号、两格缩进、单引号**（遵循项目根 ESLint 配置 `@antfu/eslint-config`）
- **具名导出**，避免 `export default`，通过 `index.ts` 统一导出
- **类型定义放在文件底部**，不影响代码阅读
- **主进程代码**（`main/`, `preload/`）使用 CommonJS 输出（electron-vite 自动处理），但源码写 ESM
- **共享代码**（`shared/`）不能引入主进程或渲染进程专用模块（如 `electron`, `react`）

---

## 常见陷阱

1. **Swift 二进制未编译**：clone 后忘记运行 `pnpm build:native`，运行时子进程启动失败
2. **窗口配置散落**：窗口参数应统一在 `shared/window-config/constants.ts` 定义，不要在多处硬编码
3. **直接使用 ipcRenderer**：渲染进程应通过 `window.$ipc` 访问，`ipcRenderer` 未通过 Context Bridge 暴露
4. **shared/ 引入端专属模块**：`shared/` 不得有任何运行时 `import` 引用 `electron`、`react`、`window.*` 等端专属 API；`import type` 可以例外，但仍应优先用字面量类型替代
5. **broadcast 误放 shared**：`renderer/broadcast/` 使用了 `window.location`，不可在主进程中导入；广播通道只能在 `renderer/` 内使用
6. **Fn 键 combo 时序**：HID 层有 50ms 抖动，处理 Combo 事件时参考 `docs/fn-key.md` 的缓冲方案，不要假设事件严格有序
