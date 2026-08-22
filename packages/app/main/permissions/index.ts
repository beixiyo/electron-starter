import type { PermissionKind, PermissionStatus } from '@shared'
import { execFile, execFileSync } from 'node:child_process'
import { createMainDiagnosticLogger } from '@main/logging'
import { ensureMediaAccess, getMediaAccessStatus } from '@main/media'
import { desktopCapturer, shell, systemPreferences } from 'electron'
import { getNativeBinaryPath } from '../native-bridge'

const log = createMainDiagnosticLogger('permission')

const SCREEN_SETTINGS_OPEN_DELAY_MS = 500
/** 授权弹窗等待用户决策，给足时间；Swift 侧 300s 自行超时退出 */
const AUDIO_CAPTURE_PROMPT_TIMEOUT_MS = 310_000
const nativePromptRequestedKinds = new Set<PermissionKind>()
/** 「仅系统音频录制」补发申请每进程只做一次，避免每场录音都拉起 helper */
let audioCaptureBackfillRequested = false

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
    fnAccessibilityTrustedCache = null
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

/**
 * fn-listener 辅助功能探测要同步 spawn 子进程（~10-50ms 阻塞主进程事件循环），
 * 而权限弹窗打开期间以 1s 轮询 permission.get——与 audioCaptureStatusCache 同理加短 TTL 缓存；
 * requestPermission 打开设置页引导授权时主动失效，保证用户决策后尽快反映
 */
const FN_ACCESSIBILITY_TRUSTED_TTL_MS = 3000
let fnAccessibilityTrustedCache: { trusted: boolean, at: number } | null = null

function isFnListenerAccessibilityTrusted(): boolean {
  if (fnAccessibilityTrustedCache && Date.now() - fnAccessibilityTrustedCache.at < FN_ACCESSIBILITY_TRUSTED_TTL_MS) {
    return fnAccessibilityTrustedCache.trusted
  }

  const trusted = probeFnListenerAccessibilityTrusted()
  fnAccessibilityTrustedCache = { trusted, at: Date.now() }
  return trusted
}

function probeFnListenerAccessibilityTrusted(): boolean {
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
 * 「仅系统音频录制」从未被询问过时补发一次授权申请
 *
 * 实测症状：某台机器权限门放行、tap 创建与启动均成功，却全程零回调
 * （systemAudioCallbacks=0），成品丢失整条系统音轨，用户毫无察觉。
 *
 * 根因机制：`requestPermission('system-audio')` 与判定走同一条
 * 「屏幕录制已授权即 granted」短路，于是 kTCCServiceAudioCapture 的系统弹窗
 * 永远不会出现。只授过屏幕录制的机器会永久停在「判定通过、tap 不出数据」，
 * 系统不会问、App 也不会提示，**用户自己无从修复**。
 *
 * 方案边界：只在 `not-determined`（从未询问过）时补发，**不改变任何放行判定**，
 * 也不阻塞调用方——本场录音照常开始，授权结果影响的是之后的录音。
 * `denied` 刻意不重试：TCC 明确拒绝后不再弹窗，重复调用只会白白拉起 helper 进程。
 *
 * 治本方向：待 `getSystemAudioPermissionDetail` 收集到跨机型数据、确认
 * 「两者任一已授权即可」这个前提在哪些机型上不成立后，应直接修正判定本身，
 * 而不是长期依赖这里补发
 */
export function requestAudioCaptureIfNeverAsked(): void {
  if (audioCaptureBackfillRequested || process.platform !== 'darwin') {
    return
  }
  if (getAudioCaptureStatus() !== 'not-determined') {
    return
  }

  audioCaptureBackfillRequested = true
  log.info('audioCapture.backfill.requested', 'requesting never-asked system audio recording permission')
  void requestAudioCaptureAccess().then((status) => {
    /** 补发是否触发、用户是否授权，正是排查「系统音轨为空」时唯一需要的一位信息 */
    log.info('audioCapture.backfill.settled', 'system audio recording permission request settled', { status })
  })
}

/**
 * 系统音权限的分解状态，仅供诊断落盘，不参与任何放行判定
 *
 * 实测症状：某台机器权限门放行（gate.passed systemAudioEnabled=true），tap 创建与启动
 * 均成功，却全程零回调（systemAudioCallbacks=0），成品丢失整条系统音轨且用户无感知。
 * 输出设备是 builtin，非虚拟声卡，也没有 tapAttachFailed。
 *
 * 待验证的疑点：`getSystemAudioPermissionStatus` 按「两者任一已授权即可」短路，
 * 屏幕录制通过时不再探测 kTCCServiceAudioCapture。若该前提在某些机型上不成立
 * （tap 实际只认 audio-only 那一项），就会正好落到上述形态。短路本身又让
 * audioCapture 从不被探测，日志里没有这一位，无法证实也无法证伪。
 *
 * 方案边界：只把两个服务的状态与最终判定分开如实上报，不改变任何放行决定
 */
export function getSystemAudioPermissionDetail(): SystemAudioPermissionDetail {
  return {
    screen: getMediaAccessStatus('screen'),
    audioCapture: getAudioCaptureStatus(),
    effective: getSystemAudioPermissionStatus(),
  }
}

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

        log.error('audio-capture.request-failed', 'audio-recorder system audio permission request failed', error)
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
      log.error('screen-capture.native-request-failed', 'audio-recorder screen capture permission request failed', error)
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
    log.error('screen-capture.electron-request-failed', 'Electron screen capture permission request failed', error)
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
    log.error('settings.open-failed', 'failed to open system privacy settings', error, { kind })
    return false
  }
}

/** 系统音权限的分解诊断结果；`effective` 是权限门实际采用的判定 */
export type SystemAudioPermissionDetail = {
  /** 屏幕录制（kTCCServiceScreenCapture） */
  screen: PermissionStatus
  /** 仅系统音频录制（kTCCServiceAudioCapture），process tap 真正依赖的那一项 */
  audioCapture: PermissionStatus
  effective: PermissionStatus
}
