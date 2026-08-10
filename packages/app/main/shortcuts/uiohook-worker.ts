/**
 * 在独立 Node Worker 中运行 uiohook native addon
 *
 * macOS 下 addon 启动失败时可能同步卡在 uv_thread_join，不能让它阻塞 Electron 主线程
 */
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { parentPort } from 'node:worker_threads'
import { uIOhook } from 'uiohook-napi'

if (!parentPort)
  throw new Error('uiohook worker requires parentPort')

const port = parentPort

uIOhook.on('keydown', event => emitKeyboardEvent('keydown', event))
uIOhook.on('keyup', event => emitKeyboardEvent('keyup', event))

port.on('message', (message: UiohookWorkerCommand) => {
  if (message.type !== 'stop')
    return

  try {
    uIOhook.stop()
  }
  finally {
    port.close()
  }
})

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

type UiohookWorkerCommand = {
  type: 'stop'
}

type UiohookWorkerMessage
  = | { type: 'ready' }
    | { type: 'failed', error: string }
    | { type: 'keydown' | 'keyup', event: UiohookKeyboardEvent }
