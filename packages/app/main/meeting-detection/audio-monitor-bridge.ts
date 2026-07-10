import { NativeBridge } from '../native-bridge'

let lastSnapshot = ''
let lastProcesses: AudioProcess[] = []

const bridge = new NativeBridge<{ change: AudioProcess[] }>({
  name: 'audio-monitor',
  parseLine(line, bus) {
    try {
      if (line === lastSnapshot)
        return
      lastSnapshot = line
      lastProcesses = JSON.parse(line)
      bus.emit('change', lastProcesses)
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

/** 当前音频进程快照，供新挂载的音源选择器立即读取 */
export function getAudioProcessSnapshot(): AudioProcess[] {
  return lastProcesses
}

export type AudioProcess = {
  pid: number
  name: string
  bundleId: string
  isRunningInput: boolean
  isRunningOutput: boolean
}
