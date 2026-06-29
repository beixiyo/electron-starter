import type { PermissionKind, PermissionStatus } from '@shared'
import { execFileSync } from 'node:child_process'
import { ensureMediaAccess, getMediaAccessStatus } from '@main/media'
import { logWarn } from '@main/utils/logger'
import { desktopCapturer, shell, systemPreferences } from 'electron'
import { getNativeBinaryPath } from '../native-bridge'

const SCREEN_SETTINGS_OPEN_DELAY_MS = 500
const nativePromptRequestedKinds = new Set<PermissionKind>()

/** macOS 各权限对应的隐私设置面板 URL */
const MACOS_PRIVACY_URLS: Record<PermissionKind, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
}

/**
 * 查询统一权限状态
 * @param kind 权限类型
 */
export function getPermissionStatus(kind: PermissionKind): PermissionStatus {
  if (kind === 'accessibility') {
    /** 非 macOS 无此概念，视为已授予 */
    if (process.platform !== 'darwin') {
      return 'granted'
    }
    return systemPreferences.isTrustedAccessibilityClient(false) && isFnListenerAccessibilityTrusted()
      ? 'granted'
      : 'denied'
  }

  return getMediaAccessStatus(kind)
}

/**
 * 主动申请权限
 * - microphone / camera：弹系统授权框；未授予则打开隐私设置
 * - screen：先触发系统屏幕录制请求，把 App / helper 注册进 TCC 列表；仍未授权时下次点击再打开隐私设置
 * - accessibility：先触发系统授权弹窗；仍未授权时下次点击再打开隐私设置
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

    if (shouldOpenSettingsFallback('accessibility')) {
      openPrivacySettings('accessibility')
      return 'denied'
    }

    markNativePromptRequested('accessibility')

    /** 传 true 会触发系统授权弹窗（首次）；非首次需用户去设置勾选 */
    const trusted = systemPreferences.isTrustedAccessibilityClient(true)
    const helperTrusted = requestFnListenerAccessibility()
    if (!trusted || !helperTrusted) {
      return 'denied'
    }
    clearSettingsFallback('accessibility')
    return 'granted'
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

  const result = await ensureMediaAccess(kind)
  if (result !== 'granted') {
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

function requestFnListenerAccessibility(): boolean {
  try {
    execFileSync(getNativeBinaryPath('fn-listener'), ['--prompt-accessibility'], {
      stdio: 'ignore',
    })
    return true
  }
  catch {
    return false
  }
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
