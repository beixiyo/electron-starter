import type { NativeRecordingSource, RecordingPhase } from '@shared'
import type { NativeRecordingSession } from './session'
import { stat, unlink } from 'node:fs/promises'
import { onRecorderEvent, pauseRecording, probeMicCaptureStrategy, resumeRecording, startRecorder, stopRecorder, stopRecording } from '@main/audio-recorder'
import { showPermissionRequired } from '@main/permission-required'
import { getPermissionStatus } from '@main/permissions'
import { deleteRecoveryRecording } from '@main/recording-recovery'
import { recordingState } from '@main/recording-state'
import { isMacOSAtLeast } from '@main/utils/macos-version'
import { app } from 'electron'
import { clearNativeRecordingSession, consumeNativeRecordingSession, peekNativeRecordingSession } from './session'
import { createNativeStartRecovery } from './start-recovery'

/**
 * Native 录音通用管线：状态机相位 → 子进程命令的转发，以及 recorder 事件的统一收尾
 *
 * 手动混系统音频录音（tap）与会议录音（ScreenCaptureKit）都走这条管线，
 * 两者共用同一 audio-recorder 子进程，并由 recordingState.nativeSource 做互斥和收尾路由
 */

let syncing = false

/**
 * 记录「下一个原生 terminal 事件来自 Discard」：
 * Discard（相位 → idle）也要让原生进程停下，但其产物不得上报——
 * starting 取消可能只收到 error / exited，已开始采集的取消则必须等 stopped 安全收尾
 */
let pendingDiscard: 'none' | 'starting' | 'active' = 'none'

let initialized = false

const handlersBySource: Partial<Record<NativeRecordingSource, NativeRecordingHandlers>> = {}
const nativeStartRecovery = createNativeStartRecovery(source => handlersBySource[source]?.onError)

/** Helper 已无法再产生 stopped 时，清理待丢弃会话及其恢复资产 */
function clearPendingDiscard(): void {
  if (pendingDiscard === 'none')
    return

  pendingDiscard = 'none'
  const session = peekNativeRecordingSession()
  clearNativeRecordingSession()
  if (session) {
    void deleteRecoveryRecording(session.taskId).catch((error) => {
      console.warn('[native-recording] failed to delete canceled recovery session', error)
    })
  }
}

/** 各录音来源注册自己的收尾处理器（手动：emit 到 recording 服务） */
export function registerNativeRecordingHandlers(source: NativeRecordingSource, handlers: NativeRecordingHandlers): void {
  handlersBySource[source] = handlers
}

/** start 命令未写入 helper 时，释放已经占用的 starting 会话 */
export function failNativeRecordingStart(
  session: NativeRecordingSession,
  code: string,
  detail?: string,
): void {
  nativeStartRecovery.fail(session, code, detail)
}

function syncToRecorder(from: RecordingPhase, to: RecordingPhase): void {
  if (to === 'starting')
    nativeStartRecovery.arm()
  else if (from === 'starting')
    nativeStartRecovery.clear()

  if (syncing || !recordingState.nativeSource)
    return

  syncing = true

  if (to === 'paused' && from === 'recording') {
    pauseRecording()
  }
  else if (to === 'recording' && from === 'paused') {
    resumeRecording()
  }
  else if (to === 'stopped' || to === 'idle') {
    if (to === 'idle') {
      /** Discard：先打标再 stop，原生 stopped 回来时按 discard 处理（删文件、不上报） */
      pendingDiscard = from === 'starting'
        ? 'starting'
        : 'active'
    }

    const session = peekNativeRecordingSession()
    if (session)
      stopRecording(session.outputPath)
    else
      console.warn('[native-recording] stop requested without an active session')
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

  onRecorderEvent('recording', ({ path, micStrategy, outputTransport }) => {
    const session = peekNativeRecordingSession()
    if (
      !session
      || session.outputPath !== path
      || session.source !== recordingState.nativeSource
    ) {
      console.warn('[native-recording] stale recorder ready ignored', {
        path,
        activePath: session?.outputPath,
        activeSource: session?.source,
        stateSource: recordingState.nativeSource,
      })
      return
    }

    /**
     * 本轮实际走的采集路线
     *
     * micStrategy 只描述 raw/capture 采集路线；软件 AEC 的实际配置由 start 命令单独记录
     * outputTransport 一并记：builtin 扬声器 + 未启用软件 AEC 才存在外放回声路径，耳机不存在
     */
    console.log('[native-recording] recording started', {
      micStrategy,
      outputTransport,
    })

    /** 只有当前 starting session 的 ready 回执才能开始计时并撤销 discard */
    if (recordingState.confirmNativeStarted())
      pendingDiscard = 'none'
  })

  onRecorderEvent('mic_degraded', ({ detail }) => {
    /** 麦克风自愈失败不是整场录音失败，系统音轨仍继续录制 */
    console.warn(`[native-recording] microphone capture degraded${detail
      ? `: ${detail}`
      : ''}`)
    const source = recordingState.nativeSource
    if (source)
      handlersBySource[source]?.onMicDegraded?.(detail)
  })

  /**
   * 录音中途麦克风重挂成功且重新选路
   *
   * 与 mic_degraded 互补：那条只在重挂彻底失败时发出，覆盖不到「重挂成功但换了路线」的
   * 静默降级——例如从 Audio Unit 路线切到 capture session，需让诊断日志保留路线变化
   */
  onRecorderEvent('mic_route_changed', ({ reason, micStrategy }) => {
    console.warn('[native-recording] microphone capture route changed mid-recording', {
      reason,
      micStrategy,
    })
  })

  onRecorderEvent('tap_attach_failed', ({ phase, detail }) => {
    console.warn('[native-recording] system audio capture failed to attach, recording continues without it', {
      phase,
      detail,
    })
  })

  onRecorderEvent('exited', ({ code, signal }) => {
    const source = recordingState.nativeSource
    const discarding = pendingDiscard !== 'none'
    if (discarding) {
      clearPendingDiscard()
      if (source)
        recordingState.finishNative()
      return
    }

    if (!source) {
      return
    }

    if (!peekNativeRecordingSession() && recordingState.snapshot.phase === 'stopped') {
      console.warn('[native-recording] late helper exit ignored after terminal session settlement')
      return
    }

    clearNativeRecordingSession()
    recordingState.finishNative()
    handlersBySource[source]?.onError('helper_exited', `code=${code} signal=${signal}`)
  })

  onRecorderEvent('error', ({ code, detail, path: errorPath, terminal }) => {
    /**
     * 录音中 Swift 子进程报错（权限被拒、设备异常、无样本）：仅手动 native 录音处理，
     * 非本管线录音（会议链路）的报错一律忽略
     * 注意不能按 isBusy 过滤——stop 收尾阶段 Swift 可能上报 no_audio_samples /
     * writer_failed（此时 phase 已是 stopped），吞掉会让 renderer 干等完成事件
     */
    const source = recordingState.nativeSource
    if (!source) {
      /** 取消始终等 stopped / terminal / helper exit；非终态错误之后 writer 仍可能继续写入 */
      if (terminal)
        clearPendingDiscard()
      return
    }

    const activeSession = peekNativeRecordingSession()
    if (!activeSession && recordingState.snapshot.phase === 'stopped') {
      console.warn('[native-recording] late recorder error ignored after terminal session settlement', {
        code,
        path: errorPath,
      })
      return
    }

    if (
      errorPath
      && activeSession
      && activeSession.outputPath !== errorPath
    ) {
      console.warn('[native-recording] stale recorder error ignored', {
        code,
        detail,
        path: errorPath,
        activePath: activeSession.outputPath,
      })
      return
    }

    if (pendingDiscard !== 'none' && terminal) {
      clearPendingDiscard()
      recordingState.finishNative()
      return
    }

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
     * Swift helper 位于真实的麦克风采集边界，它的实时 TCC 结果优先于 Electron
     * 可能过期的 getMediaAccessStatus。权限被系统设置撤销后不再重弹系统授权框，
     * 因此这里明确引导用户重新开启权限并按 macOS 要求重启 App
     */
    if (code.startsWith('microphone_permission_')) {
      showPermissionRequired({
        kinds: ['microphone'],
        reason: 'recording',
      })
    }

    if (recordingState.snapshot.phase === 'starting' && activeSession) {
      failNativeRecordingStart(activeSession, code, detail)
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
    recordingState.finishNative()
    handlersBySource[source]?.onError(code, detail)
  })

  onRecorderEvent('stopped', async ({
    path: filePath,
    duration,
    systemAudioAppends,
    micAppends,
    systemAudioRequested,
    systemAudioCallbacks,
    systemAudioDrops,
  }) => {
    /**
     * 请求了系统音却一个样本都没写入 = 整条系统音轨丢失，用户毫无察觉
     *
     * 必须单独 warn 而不是只留统计字段：那是一场正常结束的录音，不 warn 就没人会去看
     * callbacks 一并带上以区分「内核侧没出数据」和「出了数据但全被丢弃」
     */
    if (systemAudioRequested && systemAudioAppends === 0) {
      console.warn('[native-recording] system audio was requested but no samples were captured', {
        path: filePath,
        duration,
        systemAudioCallbacks,
        systemAudioDrops,
        micAppends,
      })
    }

    const stoppedSession = peekNativeRecordingSession()
    if (stoppedSession && stoppedSession.outputPath !== filePath) {
      console.warn('[native-recording] stale stopped event ignored, file left for recovery', {
        stoppedPath: filePath,
        activePath: stoppedSession.outputPath,
      })
      return
    }

    /** Discard 产物：删除文件且不发完成事件。消费标记后复位 */
    if (pendingDiscard !== 'none') {
      pendingDiscard = 'none'
      const discardedSession = peekNativeRecordingSession()
      clearNativeRecordingSession()
      if (discardedSession)
        await deleteRecoveryRecording(discardedSession.taskId)
      else
        await unlink(filePath).catch(() => { /* 忽略 */ })
      return
    }

    const session = consumeNativeRecordingSession(filePath)
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
      unlink(filePath).catch(() => { /* 忽略 */ })
      handlersBySource[session.source]?.onError('empty_recording')
      recordingState.finishNative()
      return
    }

    try {
      await handlersBySource[session.source]?.onComplete(session, filePath, duration)
    }
    finally {
      recordingState.finishNative()
    }
  })

  app.on('before-quit', () => {
    /** 录音中 quit：不杀录音子进程（避免丢产物），由上层结束确认后再收尾 */
    if (recordingState.isBusy) {
      return
    }
    stopRecorder()
  })

  startRecorder()

  /** 只读权限已授权时才预检；绝不因后台探测触发系统授权框或应用内权限门 */
  if (process.platform === 'darwin' && isMacOSAtLeast(14, 2) && getPermissionStatus('microphone') === 'granted') {
    void probeMicCaptureStrategy().then((probe) => {
      /** 只记录 raw/capture 路线；模板不启用 VPIO。 */
      console.log('[native-recording] startup microphone strategy probe completed', {
        ready: probe.ready,
        strategy: probe.strategy,
      })
    })
  }
}

export type NativeRecordingHandlers = {
  /** 录音正常结束：session 已被消费，filePath 为最终混音产物 */
  onComplete: (session: NativeRecordingSession, filePath: string, duration: number) => void | Promise<void>
  /**
   * 录音中子进程报错。除 audio_sample_timeout 外状态机已 reset、session 已清空，处理器只负责通知用户；
   * audio_sample_timeout 为挽救链路：主进程随后走正常 stop 收尾，中断前音频照常经 onComplete 交付
   *
   * @param code 错误码（no_audio_samples / writer_failed / audio_sample_timeout / no_audio_content /
   * empty_recording / handoff_timeout / handoff_interrupted 等）
   * @param message 诊断详情（Swift 侧采集统计 / writer 错误码 / 设备快照），仅用于展示与日志
   */
  onError: (code: string, message?: string) => void
  /** 麦克风自愈失败但系统音轨仍继续录制 */
  onMicDegraded?: (detail?: string) => void
}
