import type { ShortcutBindings, ShortcutRuntimeCapabilities } from '@shared/shortcuts'
import { getAppAccessibilityStatus, getFnListenerAccessibilityStatus } from '@main/permissions'
import { createElectronShortcutCapabilities, filterShortcutBindingsByCapabilities } from '@shared/shortcuts'
import { getElectronShortcutRuntimeProviders } from './providers'

/** Electron 可配置快捷键能力；用于设置页展示和持久化校验 */
export function getElectronShortcutCapabilities(): ShortcutRuntimeCapabilities {
  return getElectronShortcutConfigurationCapabilities()
}

/** Electron 可配置快捷键能力；只按平台判断，不受当前权限影响 */
export function getElectronShortcutConfigurationCapabilities(): ShortcutRuntimeCapabilities {
  return createElectronShortcutCapabilities({
    providers: getElectronShortcutRuntimeProviders(),
    global: {
      keyboard: true,
      fn: process.platform === 'darwin',
    },
    local: {
      keyboard: true,
      fn: process.platform === 'darwin',
    },
  })
}

/** Electron 当前运行时快捷键能力；按平台、权限和 native backend 状态判断 */
export function getElectronShortcutRuntimeCapabilities(): ShortcutRuntimeCapabilities {
  const fnBackendAvailable = canUseFnShortcutBackend()

  return createElectronShortcutCapabilities({
    providers: getElectronShortcutRuntimeProviders(),
    global: {
      keyboard: canUseGlobalKeyboardShortcutBackend(),
      fn: fnBackendAvailable,
    },
    local: {
      keyboard: canUseLocalKeyboardShortcutBackend(),
      fn: fnBackendAvailable,
    },
  })
}

/** 当前运行时是否可以启用系统级 keyboard 捕获 backend */
export function canUseGlobalKeyboardShortcutBackend(): boolean {
  if (process.platform !== 'darwin')
    return true

  return getAppAccessibilityStatus() === 'granted'
}

/** 当前运行时是否可以启用窗口内 keyboard 捕获 backend */
export function canUseLocalKeyboardShortcutBackend(): boolean {
  return true
}

/** 当前运行时是否可以启用 macOS Fn/Globe 捕获 backend */
export function canUseFnShortcutBackend(): boolean {
  if (process.platform !== 'darwin')
    return false

  return getAppAccessibilityStatus() === 'granted'
    && getFnListenerAccessibilityStatus() === 'granted'
}

/** 过滤可安全持久化的快捷键配置，不受当前权限开关影响 */
export function filterPersistableShortcutBindings(bindings: ShortcutBindings): ShortcutBindings {
  return filterShortcutBindingsByCapabilities(
    bindings,
    getElectronShortcutConfigurationCapabilities(),
  )
}

/** 按当前运行时能力过滤真正要注册的快捷键 */
export function filterRuntimeShortcutBindings(bindings: ShortcutBindings): ShortcutBindings {
  return filterShortcutBindingsByCapabilities(
    bindings,
    getElectronShortcutRuntimeCapabilities(),
  )
}
