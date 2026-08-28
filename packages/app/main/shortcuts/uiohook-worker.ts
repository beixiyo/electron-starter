/**
 * 在独立 Node Worker 中运行 uiohook native addon
 *
 * macOS 下 addon 启动失败时可能同步卡在 uv_thread_join，不能让它阻塞 Electron 主线程
 * Worker 首次启动后随 App 进程驻留，刻意不暴露 stop 命令：native abort 会跨 Worker
 * 终止整个 Electron 进程，不能用线程级 try/catch 或 exit 事件兜底
 */
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { parentPort } from 'node:worker_threads'
import { uIOhook } from 'uiohook-napi'

if (!parentPort)
  throw new Error('uiohook worker requires parentPort')

const port = parentPort

uIOhook.on('keydown', event => emitKeyboardEvent('keydown', event))
uIOhook.on('keyup', event => emitKeyboardEvent('keyup', event))

try {
  uIOhook.start()
  port.postMessage({ type: 'ready' } satisfies UiohookWorkerMessage)
}
catch (error) {
  port.postMessage({
    type: 'failed',
    error: error instanceof Error
      ? error.message
      : String(error),
  } satisfies UiohookWorkerMessage)
  port.close()
}

function emitKeyboardEvent(
  type: Extract<UiohookWorkerMessage, { event: unknown }>['type'],
  event: UiohookKeyboardEvent,
): void {
  port.postMessage({ type, event } satisfies UiohookWorkerMessage)
}

type UiohookWorkerMessage
  = | { type: 'ready' }
    | { type: 'failed', error: string }
    | { type: 'keydown' | 'keyup', event: UiohookKeyboardEvent }
