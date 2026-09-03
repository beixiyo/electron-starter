/**
 * macOS 隐私设置面板深链
 *
 * 独立成文件是为了让权限拖拽引导能直接复用，而不必反向依赖 `permissions/index.ts`
 * （后者会 import 引导入口，两边互引会形成循环）
 */

import { createMainDiagnosticLogger } from '@main/logging'
import type { PermissionKind } from '@shared'
import { shell } from 'electron'

const log = createMainDiagnosticLogger('permission')

/**
 * 各权限对应的隐私设置面板 URL
 *
 * 沿用 `com.apple.preference.security` 这一代 pane id：Ventura 之后系统设置改版，
 * 但该 id 仍被重定向到新面板，且 macOS 26 上的 ChatGPT / Codex 用的也正是这一串
 */
const MACOS_PRIVACY_URLS: Record<PermissionKind, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  /** 「仅系统音频录制」列表挂在 Screen & System Audio Recording 面板下方独立小节 */
  'system-audio': 'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
}

/** 打开 macOS 系统隐私设置对应面板 */
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
