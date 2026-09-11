/** Electron 快捷键捕获 provider 注册表：按平台与运行时可用性声明 Fn / keyboard 捕获能力 */

import type { ShortcutRuntimeProviderDescriptor } from '@shared/shortcuts'
import { keyboardInputBackend } from './input'

/** main 进程 Fn/Globe provider，由 macOS keyboard-listener helper 提供 */
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
 * 能力计算与运行时调度只消费派生结果。Fn 与 global keyboard 共用同一个
 * 系统级捕获后端，可用性也只看它一个
 */
const ELECTRON_SHORTCUT_RUNTIME_PROVIDER_REGISTRY: readonly ElectronShortcutRuntimeProviderRegistryEntry[] = [
  {
    descriptor: FN_SHORTCUT_RUNTIME_PROVIDER,
    platforms: ['darwin'] as const,
    isRuntimeAvailable: () => keyboardInputBackend.isAvailable(),
  },
  {
    descriptor: KEYBOARD_SHORTCUT_RUNTIME_PROVIDER,
    platforms: ['darwin', 'win32', 'linux'] as const,
    isRuntimeAvailable: () => keyboardInputBackend.isAvailable(),
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

type ElectronShortcutRuntimeProviderRegistryEntry = {
  descriptor: ShortcutRuntimeProviderDescriptor
  platforms: readonly NodeJS.Platform[]
  isRuntimeAvailable: () => boolean
}
