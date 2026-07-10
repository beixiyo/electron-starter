import type { ShortcutRuntimeProviderDescriptor } from '@shared/shortcuts'

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

/** Electron 环境所有快捷键捕获 provider 声明 */
export function getElectronShortcutRuntimeProviders(
  platform: NodeJS.Platform = process.platform,
): ShortcutRuntimeProviderDescriptor[] {
  return getPlatformShortcutRuntimeProviders(platform, {
    includeRenderer: true,
  }).map(cloneShortcutRuntimeProvider)
}

/** main runtime 实际装载的快捷键捕获 provider 声明 */
export function getMainShortcutRuntimeProviders(
  platform: NodeJS.Platform = process.platform,
): ShortcutRuntimeProviderDescriptor[] {
  return getPlatformShortcutRuntimeProviders(platform, {
    includeRenderer: false,
  }).map(cloneShortcutRuntimeProvider)
}

function getPlatformShortcutRuntimeProviders(
  platform: NodeJS.Platform,
  options: GetPlatformShortcutRuntimeProvidersOptions,
): readonly ShortcutRuntimeProviderDescriptor[] {
  const providers: ShortcutRuntimeProviderDescriptor[] = [
    KEYBOARD_SHORTCUT_RUNTIME_PROVIDER,
  ]

  if (platform === 'darwin')
    providers.unshift(FN_SHORTCUT_RUNTIME_PROVIDER)

  if (options.includeRenderer)
    providers.push(RENDERER_KEYBOARD_SHORTCUT_RUNTIME_PROVIDER)

  return providers
}

function cloneShortcutRuntimeProvider(
  provider: ShortcutRuntimeProviderDescriptor,
): ShortcutRuntimeProviderDescriptor {
  return {
    ...provider,
    scopes: [...provider.scopes],
  }
}

type GetPlatformShortcutRuntimeProvidersOptions = {
  includeRenderer: boolean
}
