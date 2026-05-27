import { NativeBridge } from '../native-bridge'

let lastSnapshot = ''

const bridge = new NativeBridge<{ change: AudioProcess[] }>({
  name: 'audio-monitor',
  parseLine(line, bus) {
    try {
      if (line === lastSnapshot)
        return
      lastSnapshot = line
      bus.emit('change', JSON.parse(line))
    }
    catch {
      console.warn('[audio-monitor] parse error:', line)
    }
  },
})

export const startAudioMonitor = () => bridge.start()
export const stopAudioMonitor = () => bridge.stop()

export function onAudioProcessChange(listener: (processes: AudioProcess[]) => void): () => void {
  return bridge.events.on('change', listener)
}

export type AudioProcess = {
  pid: number
  name: string
  bundleId: string
  isRunningInput: boolean
  isRunningOutput: boolean
}
