/**
 * 原生录音 NDJSON 协议与主进程事件契约
 */

export function parseRecorderMessage(line: string): RecorderMessage {
  return JSON.parse(line) as RecorderMessage
}

export type RecorderEvents = {
  recording: { path: string }
  paused: { path: string }
  mixing: { path: string }
  stopped: { path: string, duration: number }
  error: { code: string, detail?: string, path?: string, terminal: boolean }
  mic_degraded: { detail?: string }
  exited: { code: number | null, signal: NodeJS.Signals | null }
}

export type RecorderMessage
  = | { status: 'recording', path: string, duration?: never, detail?: never }
    | { status: 'paused', path: string, duration?: never, detail?: never }
    | { status: 'mixing', path: string, duration?: never, detail?: never }
    | { status: 'stopped', path: string, duration?: number, handoffId?: number, detail?: never }
    | { status: 'mic_degraded', detail?: string, path?: never, duration?: never }
    | { status: 'recycle_required', handoffId: number, detail?: string, path?: never, duration?: never }
    | { error: string, detail?: string, terminal?: false, path?: string, status?: never }
    | { error: string, detail?: string, terminal: true, path: string, handoffId?: number, status?: never }
