import type { NativeRecordingSource, RecordingPhase } from '@shared'
import type { NativeRecordingSession } from './session'
import { stat, unlink } from 'node:fs/promises'
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

  onRecorderEvent('error', ({ code, detail }) => {
    /**
     * 录音中 Swift 子进程报错（权限被拒、设备异常、无样本）：仅手动 native 录音处理，
     * 非本管线录音（会议链路）的报错一律忽略
     * 注意不能按 isBusy 过滤——stop 收尾阶段 Swift 可能上报 no_audio_samples /
     * writer_failed（此时 phase 已是 stopped），吞掉会让 renderer 干等完成事件
     */
    const source = recordingState.nativeSource
    if (!source)
      return

    /**
     * 重复 start 被拒（并发触发时第二次 start 的回执）：活录音本身无恙，
     * 绝不能当致命错误 reset——那会触发 discard 链路把正在录的第一路停掉并删文件
     */
    if (code === 'already_recording') {
      console.warn('[native-recording] duplicate start rejected, active recording keeps going')
      return
    }

    /** 非录音态收到 stop 的回执噪声（重复 stop / error 收尾后的补发），不是致命错误 */
    if (code === 'not_recording') {
      console.warn('[native-recording] not_recording ack ignored')
      return
    }

    /**
     * 采集中断（gap watchdog）：writer 里中断前的样本完好，绝不能走致命 reset——
     * 那会经 discard 链路把整段已录音频删掉。直接走正常 stop 收尾保留产物
     * （本仓无笔记快照需 renderer 代发，主进程即可收口），错误通知照发给 UI
     */
    if (code === 'audio_sample_timeout') {
      console.warn(`[native-recording] capture interrupted, salvaging partial recording${detail
        ? ` (${detail})`
        : ''}`)
      handlersBySource[source]?.onError(code, detail)
      recordingState.stop()
      return
    }

    console.warn(`[native-recording] recorder error: ${code}${detail
      ? ` (${detail})`
      : ''}`)
    clearNativeRecordingSession()
    recordingState.reset()
    handlersBySource[source]?.onError(code, detail)
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

    /** 0B / 缺失产物不得当成功上报——Swift 侧硬校验之外的最后一道闸（如 mixTracks 极端产物） */
    try {
      const file = await stat(filePath)
      if (file.size <= 0) {
        throw new Error(`recording file is empty: ${file.size} bytes`)
      }
    }
    catch (err) {
      console.warn('[native-recording] invalid recording file, skip completion', err)
      unlink(filePath).catch(() => { /* ignore */ })
      handlersBySource[session.source]?.onError('empty_recording')
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
  /**
   * 录音中子进程报错。除 audio_sample_timeout 外状态机已 reset、session 已清空，处理器只负责通知用户；
   * audio_sample_timeout 为挽救链路：主进程随后走正常 stop 收尾，中断前音频照常经 onComplete 交付
   *
   * @param code 错误码（no_audio_samples / writer_failed / audio_sample_timeout / no_audio_content / empty_recording 等）
   * @param message 诊断详情（Swift 侧采集统计 / writer 错误码 / 设备快照），仅用于展示与日志
   */
  onError: (code: string, message?: string) => void
}
