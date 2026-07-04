import type { NativeRecordingSource, RecordingPhase } from '@shared'
import type { NativeRecordingSession } from './session'
import { unlink } from 'node:fs/promises'
import { onRecorderEvent, pauseRecording, resumeRecording, startRecorder, stopRecorder, stopRecording } from '@main/audio-recorder'
import { recordingState } from '@main/recording-state'
import { app } from 'electron'
import { clearNativeRecordingSession, consumeNativeRecordingSession } from './session'

/**
 * Native 录音通用管线：状态机相位 → 子进程命令的转发，以及 recorder 事件的统一收尾
 *
 * 手动混系统音频录音（tap 引擎）走这条管线
 * meeting-detection 自行驱动、不走本管线——两者共用同一 audio-recorder 子进程，
 * 靠 recordingState.nativeSource 互斥：本管线只在 nativeSource 为 'manual' 时动作，
 * meeting-detection 的 recorder 事件处理器则在 nativeSource==='manual' 时早退（见其守卫）
 */

let syncing = false

/**
 * 标记「下一个原生 stopped 事件来自 Discard」：
 * Discard（相位 → idle）也要让原生进程停下，但其产物不得上报——
 * 置位后，stopped 处理改为删除文件、不向 renderer 发完成事件
 */
let discardPending = false

let initialized = false

const handlersBySource: Partial<Record<NativeRecordingSource, NativeRecordingHandlers>> = {}

/** 各录音来源注册自己的收尾处理器（手动：emit 到 recording 服务） */
export function registerNativeRecordingHandlers(source: NativeRecordingSource, handlers: NativeRecordingHandlers): void {
  handlersBySource[source] = handlers
}

function syncToRecorder(from: RecordingPhase, to: RecordingPhase): void {
  if (syncing || !recordingState.nativeSource)
    return

  syncing = true

  if (to === 'paused' && from === 'recording') {
    pauseRecording()
  }
  else if (to === 'recording' && from === 'paused') {
    resumeRecording()
  }
  else if (to === 'stopped') {
    stopRecording()
  }
  else if (to === 'idle') {
    /** Discard：先打标再 stop，原生 stopped 回来时按 discard 处理（删文件、不上报） */
    discardPending = true
    stopRecording()
  }

  syncing = false
}

/**
 * 初始化管线并拉起录音子进程。幂等：
 * 与 meeting-detection 各自调用一次 startRecorder（NativeBridge.start 幂等），
 * 谁先到谁生效
 */
export function initNativeRecordingPipeline(): void {
  if (initialized)
    return
  initialized = true

  recordingState.onPhaseChange(syncToRecorder)

  onRecorderEvent('recording', () => {
    /** 新录音开始，复位可能残留的 discard 标记，避免误删本次产物 */
    discardPending = false
  })

  onRecorderEvent('error', (error) => {
    /**
     * 录音中 Swift 子进程报错（权限被拒、设备异常）：仅手动 native 录音且 isBusy 时处理，
     * 会议链路的 not_recording 等收尾噪声、非本管线录音的报错一律忽略
     */
    const source = recordingState.nativeSource
    if (!source || !recordingState.isBusy)
      return

    /**
     * 重复 start 被拒（并发触发时第二次 start 的回执）：活录音本身无恙，
     * 绝不能当致命错误 reset——那会触发 discard 链路把正在录的第一路停掉并删文件
     */
    if (error === 'already_recording') {
      console.warn('[native-recording] duplicate start rejected, active recording keeps going')
      return
    }

    console.warn(`[native-recording] recorder error while recording: ${error}`)
    clearNativeRecordingSession()
    recordingState.reset()
    handlersBySource[source]?.onError(error)
  })

  onRecorderEvent('stopped', async ({ path: filePath, duration }) => {
    console.log(`[native-recording] audio-recorder → stopped: ${filePath} (${duration}s)`)

    /** Discard 产物：删除文件且不发完成事件。消费标记后复位 */
    if (discardPending) {
      discardPending = false
      clearNativeRecordingSession()
      unlink(filePath).catch(() => { /* ignore */ })
      return
    }

    const session = consumeNativeRecordingSession()
    if (!session) {
      /** 无本管线会话（如会议录音的 stopped）：交由其它订阅者处理，本管线跳过 */
      return
    }

    await handlersBySource[session.source]?.onComplete(session, filePath, duration)
  })

  app.on('before-quit', () => {
    /** 录音中 quit：不杀录音子进程（避免丢产物），由上层结束确认后再收尾 */
    if (recordingState.isBusy) {
      return
    }
    stopRecorder()
  })

  startRecorder()
  console.log('[native-recording] pipeline started')
}

export type NativeRecordingHandlers = {
  /** 录音正常结束：session 已被消费，filePath 为最终混音产物 */
  onComplete: (session: NativeRecordingSession, filePath: string, duration: number) => void | Promise<void>
  /** 录音中子进程报错：状态机已 reset、session 已清空，处理器只负责通知用户 */
  onError: (detail: string) => void
}
