import type { FnNativeEvent } from '@ipc/services/fn/contract'
import { NativeBridge } from '../../native-bridge'
import { requestShortcutRuntimeSync } from '../runtime-sync'
import { createFnNativeProtocolDecoder } from './protocol'

type FnListenerBackendHealth = 'unknown' | 'healthy' | 'unavailable'

let fnListenerHealth: FnListenerBackendHealth = 'unknown'
let recoveryTimer: ReturnType<typeof setTimeout> | null = null

const decoder = createFnNativeProtocolDecoder({
  onInvalidLine: reason => console.warn(`[fn] 忽略无效 native 事件: ${reason}`),
})

const bridge = new NativeBridge<FnEvents>({
  name: 'fn-listener',
  logStderr: true,
  onUnexpectedExit: handleUnexpectedExit,
  parseLine(line, bus) {
    const event = decoder.decode(line)
    if (event)
      bus.emit('raw', event)
  },
})

/** 当前运行时是否可以尝试使用 Fn 原生辅助进程 */
export function canUseFnKeyListenerBackend(): boolean {
  return fnListenerHealth !== 'unavailable'
}

export function startFnKeyListener(): void {
  if (process.platform !== 'darwin')
    return

  fnListenerHealth = 'healthy'
  clearRecoveryTimer()
  if (!bridge.running)
    emitGenerationReset()
  bridge.start()
}

export function stopFnKeyListener(): void {
  if (bridge.running)
    emitGenerationReset()
  bridge.stop()
}

export function addFnRawEventListener(listener: (event: FnNativeEvent) => void): () => void {
  return bridge.events.on('raw', listener)
}

function handleUnexpectedExit(): void {
  fnListenerHealth = 'unavailable'
  emitGenerationReset()
  requestShortcutRuntimeSync()

  if (recoveryTimer)
    return

  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    fnListenerHealth = 'unknown'
    requestShortcutRuntimeSync()
  }, 5_000)
  recoveryTimer.unref?.()
}

function emitGenerationReset(): void {
  bridge.events.emit('raw', decoder.resetGeneration(Date.now()))
}

function clearRecoveryTimer(): void {
  if (!recoveryTimer)
    return
  clearTimeout(recoveryTimer)
  recoveryTimer = null
}

type FnEvents = {
  raw: FnNativeEvent
}
