/**
 * Web 环境 `$ipc` 兜底垫片
 *
 * Electron 由 preload 往 window 注入 `$electron` / `$ipc`；web 模式（dev:web / 纯浏览器构建）
 * preload 不加载，裸标识符 `$ipc.xxx` 会直接抛 `ReferenceError`（不同于 `window.$ipc` 的 undefined）
 * 这里在「非 Electron」时给 `window.$ipc` 挂一个递归 no-op Proxy，让所有 `$ipc` 调用在 web 下安全空转：
 * - 事件订阅 `$ipc.x.on(evt, cb)` 返回可调用的空取消函数
 * - invoke `await $ipc.x.y()` 立即 resolve 为占位代理（不挂起、不抛错）
 *
 * 业务侧因此无需在每个调用点再包 `isElectron()` 判断
 *
 * ⚠️ 只注入 `$ipc`，**不注入 `$electron`**：`isElectron()` 要求两者同时存在，故注入后它在 web
 * 仍为 `false`，不会误吃掉 `isElectron() ? $ipc.x() : webFallback` 里的 web 兜底分支
 */

/**
 * 安装 web 端 `$ipc` 垫片
 *
 * 必须在任何业务模块访问 `$ipc` 之前执行（见 `renderer/main.tsx` 顶部的副作用导入）
 * Electron 下 preload 已注入真实 `$ipc`，此处直接跳过、绝不覆盖
 */
export function installWebIpcShim(): void {
  if (typeof window === 'undefined')
    return

  const w = window as unknown as { $ipc?: unknown }
  if (typeof w.$ipc !== 'undefined')
    return

  w.$ipc = createNoopIpc()
}

/**
 * 递归 no-op 代理：任意属性访问都返回自身，自身可调用且调用后仍返回自身
 *
 * - `then` / `catch` / `finally` 返回 `undefined`：让 `await proxy` 视其为非 thenable 立即 resolve，
 *   避免 `await $ipc.x.y()` 永久挂起
 * - Symbol 属性返回 `undefined`：避免被当作可迭代对象（`Symbol.iterator` 等）误用而抛错
 */
function createNoopIpc(): unknown {
  const handler: ProxyHandler<() => void> = {
    get(_target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally')
        return undefined
      if (typeof prop === 'symbol')
        return undefined
      return noop
    },
    apply() {
      return noop
    },
  }

  const noop: unknown = new Proxy(() => {}, handler)
  return noop
}
