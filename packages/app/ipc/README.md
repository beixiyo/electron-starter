# IPC 契约系统

契约定义一次，主进程和渲染进程自动获得完整类型推导

## 三个通道

契约字段按**哪一端接收**命名，和底层 Electron 注册 API 一一对应：

| 契约字段 | 底层 API | 方向 | main 侧写法 | renderer 侧写法 |
| --- | --- | --- | --- | --- |
| `mainHandle` | `ipcMain.handle` | renderer → main → renderer | `createIpcService` 的 `mainHandle` | `await $ipc.x.foo()` |
| `mainOn` | `ipcMain.on` | renderer → main | `createIpcService` 的 `mainOn` | `$ipc.x.send('foo')` |
| `rendererOn` | `ipcRenderer.on` | main → renderer | `service.emit('foo', payload)` | `$ipc.x.on('foo', cb)` |

字段名以 `main` 开头的，都是 **renderer 发、main 收**；以 `renderer` 开头的，是 **main 发、renderer 收**

```
                    mainHandle（有返回值，可 await）
                  ──────────────────────────────►
        renderer    mainOn（无返回值，不等待）      main
                  ──────────────────────────────►
                  ◄──────────────────────────────
                    rendererOn（main 发起）
```

## 我该用哪个

- 需要拿到结果，或需要确认 main 已处理 → **`mainHandle`**
- 单纯告知 main 一件事，不关心结果 → **`mainOn`**
- main 侧发生了什么（系统事件、定时器、外部回调），要告诉 renderer → **`rendererOn`**
- renderer 想"等待"某件 main 侧的事 → **`rendererOn`**，用 `on` 订阅，不要轮询

判据：**谁发起 + 要不要结果。** renderer 发起要结果用 `mainHandle`、不要结果用 `mainOn`，main 发起一律 `rendererOn`

`mainOn` 的代价是**拿不到错误**：单向通道无处回传，主进程 handler 抛的错只会被 `core/service.ts` 记进日志（`kind: 'mainOn'`），renderer 完全无感。所以任何"失败了要让用户知道"或"失败了要重试"的操作，即使不需要返回值也应该用 `mainHandle`

## 目录结构

```
ipc/
├── core/                  机制层，勿加业务
│   ├── contract.ts        IpcContract / ServiceImpl / IpcEmitter / IpcClient
│   ├── service.ts         createIpcService —— main 侧注册 + emit
│   └── client.ts          createServiceClient —— preload 侧客户端
└── services/<name>/       每个服务三件套
    ├── contract.ts        SSOT，纯类型，两端共享
    ├── service.ts         main 侧实现
    └── client.ts          preload 侧客户端
```

channel 命名统一 `namespace:name`

## 五种服务形态

### 1. 双向：mainHandle + rendererOn

```ts
// contract.ts
export type PowerContract = IpcContract<{
  mainHandle: {
    startUploadActivity: () => string           // 不含 event 首参
    stopUploadActivity: (requestId: string) => void
  }
  rendererOn: {
    event: PowerEventPayload                    // 事件名 → payload 类型
  }
}>

// service.ts —— 实现参数的字段名和契约一一对应
export const powerService = createIpcService<PowerContract>('power', {
  mainHandle: {
    async startUploadActivity(_e) {             // 首参恒为 event
      return createRequestId()
    },
    async stopUploadActivity(_e, requestId) {
      release(requestId)
    },
  },
})

// 任意时机推事件，不传 target 即广播到所有未销毁窗口
powerService.emit('event', { type: 'suspend', at: new Date().toISOString() })

// client.ts
export const powerClient = createServiceClient<PowerContract>('power', [
  'startUploadActivity',
  'stopUploadActivity',
])
```

### 2. 只有 mainHandle

其余字段省略即可：

```ts
export type MediaContract = IpcContract<{
  mainHandle: {
    getSnapshot: () => MediaSessionSnapshot | null
  }
}>
```

### 3. 只有 rendererOn（renderer 纯订阅）

实现参数传空对象，`methods` 传空数组，`createIpcService` 只为拿 `emit`：

```ts
// contract.ts
export type FnContract = IpcContract<{
  rendererOn: {
    raw: FnNativeEvent
  }
}>

// service.ts
export const fnService = createIpcService<FnContract>('fn', {})

export function sendFnRawEvent(window: BrowserWindow, event: FnNativeEvent): void {
  if (!window.isDestroyed())
    fnService.emit('raw', event, window)
}

// client.ts
export const fnClient = createServiceClient<FnContract>('fn', [])
```

### 4. 定向推送：只发给发起方

`emit` 第 3 参传 `BrowserWindow` 即定向。从 `mainHandle` 的 event 首参拿调用方：

```ts
export const screenshotService = createIpcService<ScreenshotContract>('screenshot', {
  mainHandle: {
    async startCapture(e, options) {
      const sender = (e as IpcMainInvokeEvent).sender
      const captureId = await startCapture(options, sender)
      return { captureId }
    },

    async pauseForRecord(e) {
      const win = BrowserWindow.fromWebContents((e as IpcMainInvokeEvent).sender)
      startDetection(payload => service.emit('record', payload, win ?? undefined))
    },
  },
})
```

**广播是默认值，但多窗口下往往是 bug。** 计数、落盘、导航类事件必须定向，否则每个窗口各执行一次。payload 建议带会话 id（如 `captureId`），消费方校验后再消费

### 5. 单向发送：mainOn

契约加 `mainOn` 字段，实现参数里同名加一项：

```ts
// contract.ts
export type PanelContract = IpcContract<{
  mainHandle: {
    open: () => void
  }
  mainOn: {
    heartbeat: () => void
    seen: (id: string, count: number) => void
  }
  rendererOn: {
    closed: undefined
  }
}>

// service.ts —— mainOn 的首参是 IpcMainEvent，不用强转
export const panelService = createIpcService<PanelContract>('panel', {
  mainHandle: {
    async open(_e) { showPanel() },
  },
  mainOn: {
    heartbeat(_e) { touch() },
    seen(e, id, count) { record(e.sender.id, id, count) },
  },
})

// client.ts —— 无需改动，send 和 on 一样走名字传参，不用登记名字
export const panelClient = createServiceClient<PanelContract>('panel', ['open'])

// renderer
$ipc.panel.send('seen', 'card-1', 3)
```

`send` 不返回 Promise，`await` 不了也 catch 不到。主进程 handler 声明为同步，但写成 `async` 也没关系——`createIpcService` 会把它的 rejection 一并捕获记录，不会漏成 unhandledRejection

## renderer 侧

`$ipc` 是裸全局标识符，不用 import（声明见 `preload/index.d.ts`）

```ts
// mainHandle：直接调方法
const status = await $ipc.permission.get('microphone')

// rendererOn：on 返回取消函数，直接当 useEffect 返回值
useEffect(() => $ipc.recording.on('mark', handleMark), [])

// mainOn：无返回值，不用 await
$ipc.panel.send('heartbeat')
```

web 环境（`dev:web` / 纯浏览器构建）preload 不加载，`renderer/utils/ipcWebShim.ts` 会挂递归 no-op Proxy 兜底：invoke 立即 resolve、`on` 和 `send` 安全空转，业务侧无需包 `isElectron()`。垫片**只注入 `$ipc`，绝不注入 `$electron`**

## 新增服务清单

| # | 文件 | 动作 |
| --- | --- | --- |
| 1 | `services/<name>/contract.ts` | 定义 `IpcContract<{ mainHandle, mainOn, rendererOn }>`，用不到的字段省略 |
| 2 | `services/<name>/service.ts` | `createIpcService<C>('<name>', { mainHandle, mainOn })` |
| 3 | `services/<name>/client.ts` | `createServiceClient<C>('<name>', [...方法名])` |
| 4 | `services/index.ts` | 加一行 `import './<name>/service'` |
| 5 | `preload/index.ts` | import client 并加进 `ipc` 对象 |
| 6 | `shared/ipc-types/`（可选） | 两端共享的 payload 类型 |

第 3 步的方法名数组**只列 `mainHandle` 的方法**：preload 走 `contextBridge.exposeInMainWorld`，会克隆对象，Proxy 的键枚举不到，所以必须有真实方法名列表。`on` 和 `send` 是固定的两个方法、走名字传参，契约里加了就能用，不需要登记

## 约束

- **contract 必须是纯类型**，不能 import 主进程模块，否则把 Node 侧代码拉进渲染层。跨端共用的 payload 类型放 `shared/ipc-types/`
- **实现参数是条件必填**。契约声明了 `mainHandle` 就必须实现 `mainHandle`，没声明就不许写——漏实现、多实现、写错通道名都是编译错误，不会静默不注册
- **三个通道共用 `namespace:name` 命名空间**。它们在 Electron 内部是独立的注册表（`handle` / `ipcMain.on` / `ipcRenderer.on`），同名不会串错；但日志里只看 channel 分不清是哪个通道，靠 `meta.kind` 区分。取名仍应避开
- **errorLogger 会同时收到 `mainHandle` 和 `mainOn` 的错误**，用 `meta.kind` 分流。`mainHandle` 的错误记完还会抛回 renderer，`mainOn` 的只有这一条日志
- **service 注册只能跑一次**。macOS 关主窗后 Dock activate 会重跑 `createMainWindow`，IPC 注册必须放在它外面，重复 `ipcMain.handle` 会抛异常
- **需要注入依赖的服务导出工厂函数**，不做模块级常量，由 `main/index.ts` 在时序就位后手动调（见 `shortcut-config`）
- **错误只保留 message**。`core/service.ts` 统一 catch → 记日志（含 `senderWebContentsId` / `durationMs`）→ 原样 rethrow，renderer 拿到的是 Electron 包装过的 Error，自定义字段和 `name` 会丢。renderer 需要按错误码分支时，把结果编进返回值（参考 `tracking` 的 `TrackingDispatchResult`），不要依赖 throw
- **高频流在调用侧攒批或节流，不要靠绕开契约层提速**。契约层每条只多一次字符串拼接和一个 meta 对象，相比 IPC 自身的结构化克隆和跨进程传输可以忽略；换独立 channel 走的是同一个 `ipcRenderer.send`，省不掉真正贵的那部分。`preload/index.ts` 里 `@jl-org/log` 单开 channel 是因为它是外部包、不认识本项目的契约，与性能无关
