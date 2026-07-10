import type { PermissionKind, PermissionStatus } from '@shared'
import { execFile, execFileSync } from 'node:child_process'
import { ensureMediaAccess, getMediaAccessStatus } from '@main/media'
import { logWarn } from '@main/utils/logger'
import { desktopCapturer, shell, systemPreferences } from 'electron'
import { getNativeBinaryPath } from '../native-bridge'

const SCREEN_SETTINGS_OPEN_DELAY_MS = 500
/** 授权弹窗等待用户决策，给足时间；Swift 侧 300s 自行超时退出 */
const AUDIO_CAPTURE_PROMPT_TIMEOUT_MS = 310_000
const nativePromptRequestedKinds = new Set<PermissionKind>()

/** macOS 各权限对应的隐私设置面板 URL */
const MACOS_PRIVACY_URLS: Record<PermissionKind, string> = {
  'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  'camera': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  'screen': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  'accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  /** 「仅系统音频录制」列表挂在 Screen & System Audio Recording 面板下方独立小节 */
  'system-audio': 'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
}

/**
 * 查询统一权限状态
 * @param kind 权限类型
 */
export function getPermissionStatus(kind: PermissionKind): PermissionStatus {
  if (kind === 'accessibility') {
    return getAppAccessibilityStatus() === 'granted'
      && getFnListenerAccessibilityStatus() === 'granted'
      ? 'granted'
      : 'denied'
  }

  if (kind === 'system-audio') {
    if (process.platform !== 'darwin') {
      return 'granted'
    }
    return getSystemAudioPermissionStatus()
  }

  return getMediaAccessStatus(kind)
}

/** 当前 Electron App 进程的辅助功能授权；普通 keyboard 全局监听依赖它 */
export function getAppAccessibilityStatus(): PermissionStatus {
  /** 非 macOS 无此概念，视为已授予 */
  if (process.platform !== 'darwin')
    return 'granted'

  return systemPreferences.isTrustedAccessibilityClient(false)
    ? 'granted'
    : 'denied'
}

/** Fn listener helper 的辅助功能授权；Fn/Globe 捕获 backend 依赖它 */
export function getFnListenerAccessibilityStatus(): PermissionStatus {
  /** 非 macOS 无此概念；Fn backend 仍由平台能力单独判断 */
  if (process.platform !== 'darwin')
    return 'granted'

  return isFnListenerAccessibilityTrusted()
    ? 'granted'
    : 'denied'
}

/**
 * 主动申请权限
 * - microphone / camera：未请求过时弹系统授权框；已拒绝 / 受限时打开隐私设置
 * - screen：先触发系统屏幕录制请求，把 App / helper 注册进 TCC 列表；仍未授权时下次点击再打开隐私设置
 * - accessibility：直接打开辅助功能隐私设置面板
 *
 * 原则：同一次点击只走一种系统入口，避免“原生权限弹窗”和“手动打开设置页”同时出现
 */
export async function requestPermission(kind: PermissionKind): Promise<PermissionStatus> {
  if (kind === 'accessibility') {
    if (process.platform !== 'darwin') {
      return 'granted'
    }

    if (getPermissionStatus('accessibility') === 'granted') {
      clearSettingsFallback('accessibility')
      return 'granted'
    }

    openPrivacySettings('accessibility')
    return getPermissionStatus('accessibility')
  }

  if (kind === 'system-audio') {
    if (process.platform !== 'darwin') {
      return 'granted'
    }

    if (getSystemAudioPermissionStatus() === 'granted') {
      clearSettingsFallback('system-audio')
      return 'granted'
    }

    /** 已发起过一次原生弹窗（被拒 / 未决）→ 二次点击改开隐私设置引导 */
    if (shouldOpenSettingsFallback('system-audio')) {
      openPrivacySettings('system-audio')
      return getSystemAudioPermissionStatus()
    }

    markNativePromptRequested('system-audio')

    const status = await requestAudioCaptureAccess()
    if (status === 'granted' || getSystemAudioPermissionStatus() === 'granted') {
      clearSettingsFallback('system-audio')
      return 'granted'
    }
    return status
  }

  if (kind === 'screen') {
    if (getMediaAccessStatus('screen') === 'granted') {
      clearSettingsFallback('screen')
      return 'granted'
    }

    if (shouldOpenSettingsFallback('screen')) {
      await sleep(SCREEN_SETTINGS_OPEN_DELAY_MS)
      openPrivacySettings('screen')
      return getMediaAccessStatus('screen')
    }

    markNativePromptRequested('screen')

    /**
     * 屏幕录制权限没有真正的 not-determined 态：从未授权的机器上
     * `getMediaAccessStatus('screen')` 直接返回 'denied'（Electron #36722 / #35039）
     * 因此不能用 status 区分「从未询问」与「已拒绝」，只要未授予就主动发起一次真实捕获，
     * 让系统把 App 注册进「屏幕录制」列表（首次会弹窗，已拒绝则静默但条目已落入列表）
     */
    const nativeStatus = requestAudioRecorderScreenCaptureAccess()
    await requestElectronScreenCaptureAccess()

    const status = getMediaAccessStatus('screen')
    const granted = status === 'granted' || nativeStatus === 'granted'
    if (granted) {
      clearSettingsFallback('screen')
    }
    return granted
      ? 'granted'
      : status
  }

  const currentStatus = getMediaAccessStatus(kind)
  const result = await ensureMediaAccess(kind)
  if (result !== 'granted' && currentStatus !== 'not-determined') {
    openPrivacySettings(kind)
  }
  return result
}

function shouldOpenSettingsFallback(kind: PermissionKind): boolean {
  return nativePromptRequestedKinds.has(kind)
}

function markNativePromptRequested(kind: PermissionKind): void {
  nativePromptRequestedKinds.add(kind)
}

function clearSettingsFallback(kind: PermissionKind): void {
  nativePromptRequestedKinds.delete(kind)
}

function isFnListenerAccessibilityTrusted(): boolean {
  try {
    execFileSync(getNativeBinaryPath('fn-listener'), ['--check-accessibility'], {
      stdio: 'ignore',
    })
    return true
  }
  catch {
    return false
  }
}

/**
 * system-audio 探测要同步 spawn 子进程（~10-30ms 阻塞主进程事件循环），
 * 而权限弹窗打开期间以 1s 轮询 permission.get——必须加短 TTL 缓存；
 * 授权弹窗有结果时主动失效，保证用户决策后立即反映
 */
const AUDIO_CAPTURE_STATUS_TTL_MS = 3000
let audioCaptureStatusCache: { status: PermissionStatus, at: number } | null = null

/**
 * macOS 当前把「录屏 + 系统音频」放在同一个 Screen & System Audio Recording 面板：
 * 用户可授权“屏幕和音频”，也可只授权“音频”。Core Audio tap 还可走
 * kTCCServiceAudioCapture 的 audio-only 探测；两者任一已授权，都满足系统音频录制
 */
function getSystemAudioPermissionStatus(): PermissionStatus {
  if (getMediaAccessStatus('screen') === 'granted') {
    return 'granted'
  }

  return getAudioCaptureStatus()
}

function getAudioCaptureStatus(): PermissionStatus {
  if (audioCaptureStatusCache && Date.now() - audioCaptureStatusCache.at < AUDIO_CAPTURE_STATUS_TTL_MS) {
    return audioCaptureStatusCache.status
  }

  const status = probeAudioCaptureStatus()
  audioCaptureStatusCache = { status, at: Date.now() }
  return status
}

/**
 * 录音前确保麦克风权限：
 * - 已授予 → 直接放行
 * - 未授予 → 弹系统授权框（not-determined）/ 打开隐私设置（denied），最终仍未授予返回 false
 */
export async function ensureMicrophonePermission(): Promise<boolean> {
  if (getPermissionStatus('microphone') === 'granted') {
    return true
  }

  return (await requestPermission('microphone')) === 'granted'
}

/**
 * 「仅系统音频录制」权限状态（kTCCServiceAudioCapture）
 *
 * 无公开 Electron API，经 audio-recorder --check-audio-capture（私有 TCC SPI）探测
 * exit code：0=granted 1=denied 2=not-determined 3=SPI 不可用 4=macOS < 14.2；
 * 3/4 返回 'unknown'，调用方按「不硬卡」处理（首次 AudioDeviceStart 仍会触发系统弹窗）
 */
function probeAudioCaptureStatus(): PermissionStatus {
  try {
    execFileSync(getNativeBinaryPath('audio-recorder'), ['--check-audio-capture'], {
      stdio: 'ignore',
    })
    return 'granted'
  }
  catch (error) {
    const status = (error as { status?: number })?.status
    if (status === 1) {
      return 'denied'
    }
    if (status === 2) {
      return 'not-determined'
    }
    return 'unknown'
  }
}

/** 触发「仅系统音频录制」授权弹窗（TCCAccessRequest），异步等待用户决策，不阻塞主进程 */
function requestAudioCaptureAccess(): Promise<PermissionStatus> {
  return new Promise((resolve) => {
    execFile(
      getNativeBinaryPath('audio-recorder'),
      ['--prompt-audio-capture'],
      { timeout: AUDIO_CAPTURE_PROMPT_TIMEOUT_MS },
      (error) => {
        audioCaptureStatusCache = null

        if (!error) {
          resolve('granted')
          return
        }

        const status = (error as { code?: number | string })?.code
        if (status === 1) {
          resolve('denied')
          return
        }
        if (status === 2) {
          resolve('not-determined')
          return
        }

        logWarn('触发 audio-recorder 系统音频录制授权时发生错误', {
          module: 'permissions',
          operation: 'requestAudioCaptureAccess',
          context: { error: String(error) },
        })
        resolve('unknown')
      },
    )
  })
}

function requestAudioRecorderScreenCaptureAccess(): PermissionStatus {
  if (process.platform !== 'darwin') {
    return 'granted'
  }

  try {
    execFileSync(getNativeBinaryPath('audio-recorder'), ['--prompt-screen-capture'], {
      stdio: 'ignore',
    })
    return 'granted'
  }
  catch (error) {
    const status = (error as { status?: number })?.status
    if (status !== 1) {
      logWarn('触发 audio-recorder 屏幕录制授权时发生错误', {
        module: 'permissions',
        operation: 'requestAudioRecorderScreenCaptureAccess',
        context: { error: String(error) },
      })
    }
    return 'denied'
  }
}

async function requestElectronScreenCaptureAccess(): Promise<void> {
  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 64, height: 64 },
    })
  }
  catch (error) {
    logWarn('触发 Electron 屏幕录制授权时发生错误', {
      module: 'permissions',
      operation: 'requestElectronScreenCaptureAccess',
      context: { error: String(error) },
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 打开 macOS 系统隐私设置对应面板
 * @returns 是否成功发起打开（非 macOS 返回 false）
 */
export function openPrivacySettings(kind: PermissionKind): boolean {
  if (process.platform !== 'darwin') {
    return false
  }

  const url = MACOS_PRIVACY_URLS[kind]
  if (!url) {
    return false
  }

  try {
    shell.openExternal(url)
    return true
  }
  catch (error) {
    logWarn('打开系统隐私设置失败', {
      module: 'permissions',
      operation: 'openPrivacySettings',
      context: { kind, error: String(error) },
    })
    return false
  }
}
