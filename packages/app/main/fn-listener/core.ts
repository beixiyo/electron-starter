import type { FnComboKey } from '@ipc/services/fn/contract'
import { NativeBridge } from '../native-bridge'

const bridge = new NativeBridge<FnEvents>({
  name: 'fn-listener',
  logStderr: true,
  parseLine(line, bus) {
    if (line === 'FN_DOWN')
      bus.emit('key', 'down')
    else if (line === 'FN_UP')
      bus.emit('key', 'up')
    else if (line.startsWith('FN_COMBO_'))
      bus.emit('combo', line.slice(9) as FnComboKey)
  },
})

export const startFnKeyListener = () => bridge.start()
export const stopFnKeyListener = () => bridge.stop()

export function addFnKeyListener(listener: (event: FnKeyEvent) => void): () => void {
  return bridge.events.on('key', listener)
}

export function removeFnKeyListener(listener: (event: FnKeyEvent) => void): void {
  bridge.events.off('key', listener)
}

export function addFnComboListener(listener: (key: FnComboKey) => void): () => void {
  return bridge.events.on('combo', listener)
}

type FnEvents = {
  key: FnKeyEvent
  combo: FnComboKey
}

export type FnKeyEvent = 'down' | 'up'
export type FnKeyListener = (event: FnKeyEvent) => void
export type FnComboListener = (key: FnComboKey) => void
