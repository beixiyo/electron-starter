import type { ShortcutRuntimeProviderDescriptor } from '@shared/shortcuts'
import { getAppAccessibilityStatus, getFnListenerAccessibilityStatus } from '@main/permissions'
import { canUseFnKeyListenerBackend } from './fn/core'
import { canUseUiohookBackend } from './uiohook-lifecycle'

/** main 进程 Fn/Globe provider，负责 macOS native helper 事件 */
export const FN_SHORTCUT_RUNTIME_PROVIDER = {
  id: 'fn',
  source: 'fn',
  scopes: ['global', 'local'],
} as const satisfies ShortcutRuntimeProviderDescriptor

/** main 进程 keyboard provider，负责系统级全局键盘事件 */
export const KEYBOARD_SHORTCUT_RUNTIME_PROVIDER = {
  id: 'keyboard',
  source: 'keyboard',
  scopes: ['global'],
} as const satisfies ShortcutRuntimeProviderDescriptor

/** renderer DOM provider，负责窗口聚焦时的本地键盘事件 */
export const RENDERER_KEYBOARD_SHORTCUT_RUNTIME_PROVIDER = {
  id: 'renderer-keyboard',
  source: 'keyboard',
  scopes: ['local'],
} as const satisfies ShortcutRuntimeProviderDescriptor

/**
 * Electron 快捷键捕获提供方注册表
 *
 * 捕获提供方的描述、平台过滤和运行时可用性都在这里集中声明；
 * 能力计算与运行时调度只消费派生结果，新增捕获后端
 * 时不需要再维护一套独立的能力矩阵
 */
const ELECTRON_SHORTCUT_RUNTIME_PROVIDER_REGISTRY: readonly ElectronShortcutRuntimeProviderRegistryEntry[] = [
  {
    descriptor: FN_SHORTCUT_RUNTIME_PROVIDER,
    platforms: ['darwin'] as const,
    isRuntimeAvailable: canUseFnProvider,
  },
  {
    descriptor: KEYBOARD_SHORTCUT_RUNTIME_PROVIDER,
    platforms: ['darwin', 'win32', 'linux'] as const,
    isRuntimeAvailable: canUseKeyboardProvider,
  },
  {
    descriptor: RENDERER_KEYBOARD_SHORTCUT_RUNTIME_PROVIDER,
    platforms: ['darwin', 'win32', 'linux'] as const,
    isRuntimeAvailable: () => true,
  },
]

/** Electron 环境所有快捷键捕获 provider 声明 */
export function getElectronShortcutRuntimeProviders(
  platform: NodeJS.Platform = process.platform,
): readonly ShortcutRuntimeProviderDescriptor[] {
  return getShortcutRuntimeProviderEntries(platform).map(entry => entry.descriptor)
}

/** 当前捕获提供方是否有可用的捕获后端 */
export function isElectronShortcutRuntimeProviderAvailable(
  providerId: string,
): boolean {
  const entry = getShortcutRuntimeProviderEntries(process.platform)
    .find(candidate => candidate.descriptor.id === providerId)

  return entry?.isRuntimeAvailable() ?? false
}

/** 当前平台和运行位置下的捕获提供方注册表条目 */
function getShortcutRuntimeProviderEntries(
  platform: NodeJS.Platform,
): readonly ElectronShortcutRuntimeProviderRegistryEntry[] {
  return ELECTRON_SHORTCUT_RUNTIME_PROVIDER_REGISTRY.filter(entry => (
    entry.platforms.includes(platform)
  ))
}

function canUseFnProvider(): boolean {
  return process.platform === 'darwin'
    && getAppAccessibilityStatus() === 'granted'
    && getFnListenerAccessibilityStatus() === 'granted'
    && canUseFnKeyListenerBackend()
}

function canUseKeyboardProvider(): boolean {
  /** libuiohook 无法可靠监听原生 Wayland 会话，直接交给聚焦窗口的 DOM 兜底方案 */
  if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland')
    return false

  return canUseUiohookBackend()
    && (process.platform !== 'darwin' || getAppAccessibilityStatus() === 'granted')
}

type ElectronShortcutRuntimeProviderRegistryEntry = {
  descriptor: ShortcutRuntimeProviderDescriptor
  platforms: readonly NodeJS.Platform[]
  isRuntimeAvailable: () => boolean
}
