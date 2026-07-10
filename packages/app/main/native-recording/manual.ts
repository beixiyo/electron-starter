import type { AudioSourceCaptureOptions, AudioSourceCaptureResult, ManualRecordingPrefs } from '@ipc/services/recording/contract'
import type { RecordingSnapshot } from '@shared'
import { startRecording, updateRecording } from '@main/audio-recorder'
import { getPermissionStatus, requestPermission } from '@main/permissions'
import { createRecordingRecoverySession } from '@main/recording-recovery'
import { recordingState } from '@main/recording-state'
import { ensureRecordingStorageAvailable } from '@main/recording-storage'
import { isMacOSAtLeast } from '@main/utils/macos-version'
import { getSelfProcessPids } from '@main/utils/self-pids'
import { initNativeRecordingPipeline } from '.'
import { setNativeRecordingSession } from './session'

/**
 * 手动 native tap 录音（主进程收口）
 *
 * 桌面端 macOS 14.2+ 走 Core Audio tap 引擎：mic 恒预建、系统音轨（所有软件）按「混入系统音频」
 * 开关随启动挂载，录音中可经 setAudioSourceCapture 独立热挂/卸，无需分段重启
 * 更早系统 / 非 darwin 由 renderer 回退浏览器 mic 采集（不走本模块）
 *
 * 权限 UX 由 renderer 的 usePermissions.ensure 负责（麦克风 + 系统音频）；主进程只做防御性降级，
 * 不再弹应用内说明弹窗。偏好由 renderer 经 setManualRecordingPrefs 在开录前同步（内存态，不落盘）
 */

/** 内存态偏好：renderer 每次开录 / 音源变更前同步；默认仅麦克风 */
let manualPrefs: ManualRecordingPrefs = {
  micEnabled: true,
  mixSystemAudio: false,
  pids: [],
}

export function setManualRecordingPrefs(prefs: ManualRecordingPrefs): void {
  manualPrefs = prefs
}

/** Core Audio process tap 的系统门槛（CATapDescription / AudioHardwareCreateProcessTap 均 14.2+） */
export function isSystemAudioRecordingSupported(): boolean {
  return process.platform === 'darwin' && isMacOSAtLeast(14, 2)
}

/** system-audio 为 'unknown'（TCC SPI 不可用）时不硬卡：首次 AudioDeviceStart 仍会触发系统授权弹窗 */
function isSystemAudioPermissionUsable(): boolean {
  const status = getPermissionStatus('system-audio')
  return status === 'granted' || status === 'unknown'
}

/**
 * start 全程互斥锁：isBusy 的相位切换发生在 startRecording 前后，
 * 仅靠 isBusy 挡不住双击并发触发——第二次 start 会被 Swift 以 already_recording 拒绝，
 * 该错误若被当致命处理会连带杀掉第一路录音
 */
let startingManual = false

export async function startManualRecording(): Promise<RecordingSnapshot> {
  if (!isSystemAudioRecordingSupported() || startingManual || !recordingState.canStart) {
    return recordingState.snapshot
  }

  startingManual = true
  try {
    if (!await ensureRecordingStorageAvailable())
      return recordingState.snapshot

    const micEnabled = manualPrefs.micEnabled
    const mixSystemAudio = manualPrefs.mixSystemAudio
    const selectedPids = mixSystemAudio
      ? manualPrefs.pids
      : []

    /** 用户没有选择音源时拒绝开录，不擅自开启麦克风 */
    if (!micEnabled && !mixSystemAudio)
      return recordingState.snapshot

    /**
     * 系统音频权限缺失时拒绝开录，不把用户选择的 system-only 偷换成麦克风
     */
    if (mixSystemAudio && !isSystemAudioPermissionUsable()) {
      return recordingState.snapshot
    }

    /** 幂等：确保 audio-recorder 子进程与管线已就绪（可能早于 meeting-detection 初始化） */
    initNativeRecordingPipeline()

    const session = createRecordingRecoverySession('manual', undefined, {
      micAudio: micEnabled,
      systemAudio: mixSystemAudio,
    })
    setNativeRecordingSession(session)
    const snapshot = recordingState.startManualNative()

    startRecording(session.outputPath, {
      engine: 'tap',
      tapEnabled: mixSystemAudio,
      pids: selectedPids,
      excludePids: getSelfProcessPids(),
      mic: micEnabled,
    })
    console.log(`[recording] manual native recording started (mic=${micEnabled}, mix=${mixSystemAudio}, pids=[${selectedPids.join(',')}])`)
    return snapshot
  }
  finally {
    startingManual = false
  }
}

/**
 * 手动 native 录音进行中热挂/卸音源（音源多选条勾选变化时调用，下发完整音源状态）
 *
 * 开启系统音轨且权限未定时即时弹系统授权框（录音不中断，等待期间已挂音源照常写入）；
 * 被拒则不改动录音、如实返回失败，由 renderer 回退该源选中态并提示
 */
export async function setAudioSourceCapture(options: AudioSourceCaptureOptions): Promise<AudioSourceCaptureResult> {
  const { micEnabled, systemEnabled } = options

  if (recordingState.nativeSource !== 'manual' || !recordingState.isBusy) {
    return { ok: false, reason: 'not-recording' }
  }

  if (systemEnabled && !isSystemAudioPermissionUsable()) {
    const requested = await requestPermission('system-audio')
    if (requested !== 'granted' && requested !== 'unknown') {
      return { ok: false, reason: 'permission-denied' }
    }

    /** 授权弹窗可能挂数分钟：期间录音可能已结束，陈旧 update 不能套到新录音上 */
    if (recordingState.nativeSource !== 'manual' || !recordingState.isBusy) {
      return { ok: false, reason: 'not-recording' }
    }
  }

  updateRecording({
    micEnabled,
    tapEnabled: systemEnabled,
    pids: systemEnabled
      ? options.pids
      : [],
    excludePids: getSelfProcessPids(),
  })
  return { ok: true }
}
