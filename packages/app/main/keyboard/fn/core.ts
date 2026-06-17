import type { FnComboKey, Modifier } from '@ipc/services/fn/contract'
import { NativeBridge } from '../../native-bridge'

export type FnComboEvent = { key: FnComboKey, modifiers: Modifier[] }

const bridge = new NativeBridge<FnEvents>({
  name: 'fn-listener',
  logStderr: true,
  parseLine(line, bus) {
    if (line === 'FN_DOWN') {
      bus.emit('key', 'down')
    }
    else if (line === 'FN_UP') {
      bus.emit('key', 'up')
    }
    else if (line.startsWith('FN_COMBO_')) {
      const rest = line.slice(9)
      const colonIdx = rest.indexOf(':')
      if (colonIdx === -1) {
        bus.emit('combo', { key: rest as FnComboKey, modifiers: [] })
      }
      else {
        const key = rest.slice(0, colonIdx) as FnComboKey
        const modifiers = rest.slice(colonIdx + 1).split(',') as Modifier[]
        bus.emit('combo', { key, modifiers })
      }
    }
  },
})

export const startFnKeyListener = () => bridge.start()
export const stopFnKeyListener = () => bridge.stop()
export const restartFnKeyListener = () => bridge.restart()
export const isFnKeyListenerRunning = () => bridge.running

export function addFnKeyListener(listener: (event: FnKeyEvent) => void): () => void {
  return bridge.events.on('key', listener)
}

export function removeFnKeyListener(listener: (event: FnKeyEvent) => void): void {
  bridge.events.off('key', listener)
}

export function addFnComboListener(listener: (combo: FnComboEvent) => void): () => void {
  return bridge.events.on('combo', listener)
}

type FnEvents = {
  key: FnKeyEvent
  combo: FnComboEvent
}

export type FnKeyEvent = 'down' | 'up'
export type FnKeyListener = (event: FnKeyEvent) => void
export type FnComboListener = (combo: FnComboEvent) => void
