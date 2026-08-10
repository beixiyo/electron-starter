import type { ShortcutBindings, ShortcutRuntimeCapabilities } from '@shared/shortcuts'
import { createElectronShortcutCapabilities, filterShortcutBindingsByCapabilities, toEffectiveShortcutBindings } from '@shared/shortcuts'
import { getElectronShortcutRuntimeProviders, isElectronShortcutRuntimeProviderAvailable } from './providers'
import { refreshUiohookBackendHealth } from './uiohook-lifecycle'

/** Electron 可配置快捷键能力；只按平台判断，不受当前权限影响 */
export function getElectronShortcutCapabilities(): ShortcutRuntimeCapabilities {
  const providers = getElectronShortcutRuntimeProviders()

  return createElectronShortcutCapabilities({
    providers,
    global: {
      keyboard: hasProviderScope(providers, 'keyboard', 'global'),
      fn: hasProviderScope(providers, 'fn', 'global'),
    },
    local: {
      keyboard: hasProviderScope(providers, 'keyboard', 'local'),
      fn: hasProviderScope(providers, 'fn', 'local'),
    },
  })
}

/** Electron 当前运行时快捷键能力；按平台、权限和 native backend 状态判断 */
export function getElectronShortcutRuntimeCapabilities(): ShortcutRuntimeCapabilities {
  /**
   * uIOhook 的权限探测只覆盖 macOS；Windows/Linux 还需要实际 start 才能知道
   * native backend 是否可用（例如 Wayland 下常见的启动失败）。失败状态会在
   * lifecycle 中触发 runtime sync，使下一次解析直接降级到 renderer DOM。
   */
  refreshUiohookBackendHealth()
  const providers = getElectronShortcutRuntimeProviders()
  const fnAvailable = isElectronShortcutRuntimeProviderAvailable('fn')

  return createElectronShortcutCapabilities({
    providers,
    global: {
      keyboard: isElectronShortcutRuntimeProviderAvailable('keyboard'),
      fn: fnAvailable,
    },
    local: {
      keyboard: isElectronShortcutRuntimeProviderAvailable('renderer-keyboard'),
      fn: fnAvailable,
    },
  })
}

/** 当前运行时是否可以启用系统级 keyboard 捕获 backend */
export function canUseGlobalKeyboardShortcutBackend(): boolean {
  return isElectronShortcutRuntimeProviderAvailable('keyboard')
}

/** 当前运行时是否可以启用窗口内 keyboard 捕获 backend */
export function canUseLocalKeyboardShortcutBackend(): boolean {
  return isElectronShortcutRuntimeProviderAvailable('renderer-keyboard')
}

/** 当前运行时是否可以启用 macOS Fn/Globe 捕获 backend */
export function canUseFnShortcutBackend(): boolean {
  return isElectronShortcutRuntimeProviderAvailable('fn')
}

/** 过滤可安全持久化的快捷键配置，不受当前权限开关影响 */
export function filterPersistableShortcutBindings(bindings: ShortcutBindings): ShortcutBindings {
  return filterShortcutBindingsByCapabilities(
    bindings,
    getElectronShortcutCapabilities(),
  )
}

/**
 * 按当前运行时能力解析真正要注册的快捷键，scope 为降级后的实际值
 *
 * 声明 global 但系统级捕获不可用时会降级成 local，交由渲染进程 DOM backend 接管；
 * main 侧 backend 各自按 source / scope 决定是否认领
 */
export function resolveRuntimeShortcutBindings(bindings: ShortcutBindings): ShortcutBindings {
  return toEffectiveShortcutBindings(
    bindings,
    getElectronShortcutRuntimeCapabilities(),
  )
}

function hasProviderScope(
  providers: ReturnType<typeof getElectronShortcutRuntimeProviders>,
  source: 'keyboard' | 'fn',
  scope: 'global' | 'local',
): boolean {
  return providers.some(provider => (
    provider.source === source
    && provider.scopes.includes(scope)
  ))
}
