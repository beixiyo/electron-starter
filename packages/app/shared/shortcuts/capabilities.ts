import type {
  ShortcutBinding,
  ShortcutBindings,
  ShortcutGestureBinding,
  ShortcutGestureType,
  ShortcutInputSource,
  ShortcutRuntimeCapabilities,
  ShortcutRuntimePlatform,
  ShortcutRuntimeProviderDescriptor,
  ShortcutScope,
  ShortcutScopeCapabilities,
} from './types'
import { SHORTCUT_GESTURES } from './types'

export const WEB_SHORTCUT_CAPABILITIES = createShortcutRuntimeCapabilities({
  platform: 'web',
  providers: [
    { id: 'dom-keyboard', source: 'keyboard', scopes: ['local'] },
  ],
  global: {
    keyboard: [],
    fn: [],
  },
  local: {
    keyboard: [...SHORTCUT_GESTURES],
    fn: [],
  },
})

export function cloneShortcutRuntimeCapabilities(
  capabilities: ShortcutRuntimeCapabilities,
): ShortcutRuntimeCapabilities {
  return {
    platform: capabilities.platform,
    providers: cloneShortcutRuntimeProviders(capabilities.providers),
    scopes: {
      global: cloneShortcutScopeCapabilities(capabilities.scopes.global),
      local: cloneShortcutScopeCapabilities(capabilities.scopes.local),
    },
  }
}

export function createElectronShortcutCapabilities(options: CreateElectronShortcutCapabilitiesOptions): ShortcutRuntimeCapabilities {
  return createShortcutRuntimeCapabilities({
    platform: 'electron',
    providers: options.providers,
    global: {
      keyboard: toSupportedGestures(options.global.keyboard),
      fn: toSupportedGestures(options.global.fn),
    },
    local: {
      keyboard: toSupportedGestures(options.local.keyboard),
      fn: toSupportedGestures(options.local.fn),
    },
  })
}

export function isShortcutBindingSupported(
  binding: ShortcutBinding,
  capabilities: ShortcutRuntimeCapabilities,
): boolean {
  return isShortcutGestureSupportedByChord(binding)
    && getShortcutSupportedGestures(capabilities, binding.scope, binding.chord.source)
      .includes(binding.gesture)
}

export function isShortcutGestureSupportedByChord(binding: ShortcutGestureBinding): boolean {
  if (binding.chord.source !== 'fn')
    return true

  if (binding.chord.key === 'Fn')
    return binding.gesture !== 'press'

  return binding.gesture !== 'hold'
}

export function filterShortcutBindingsByCapabilities(
  bindings: ShortcutBindings,
  capabilities: ShortcutRuntimeCapabilities,
): ShortcutBindings {
  return Object.fromEntries(
    Object.entries(bindings).map(([id, binding]) => [
      id,
      binding && isShortcutBindingSupported(binding, capabilities)
        ? binding
        : null,
    ]),
  )
}

export function canUseShortcutScope(
  capabilities: ShortcutRuntimeCapabilities,
  scope: ShortcutScope,
): boolean {
  const sources = capabilities.scopes[scope]
  return Object.values(sources).some(gestures => gestures.length > 0)
}

export function getShortcutSupportedGestures(
  capabilities: ShortcutRuntimeCapabilities,
  scope: ShortcutScope,
  source: ShortcutInputSource,
): readonly ShortcutGestureType[] {
  return capabilities.scopes[scope][source]
}

function createShortcutRuntimeCapabilities(
  options: CreateShortcutRuntimeCapabilitiesOptions,
): ShortcutRuntimeCapabilities {
  return {
    platform: options.platform,
    providers: cloneShortcutRuntimeProviders(options.providers),
    scopes: {
      global: cloneShortcutScopeCapabilities(options.global),
      local: cloneShortcutScopeCapabilities(options.local),
    },
  }
}

function cloneShortcutRuntimeProviders(
  providers: readonly ShortcutRuntimeProviderDescriptor[],
): ShortcutRuntimeProviderDescriptor[] {
  return providers.map(provider => ({
    ...provider,
    scopes: [...provider.scopes],
  }))
}

function cloneShortcutScopeCapabilities(
  capabilities: ShortcutScopeCapabilities,
): ShortcutScopeCapabilities {
  return {
    keyboard: [...capabilities.keyboard],
    fn: [...capabilities.fn],
  }
}

function toSupportedGestures(canUse: boolean): ShortcutGestureType[] {
  return canUse
    ? [...SHORTCUT_GESTURES]
    : []
}

/** Electron runtime 能力配置 */
export type CreateElectronShortcutCapabilitiesOptions = {
  /** 当前 Electron runtime / renderer 可用的捕获 provider */
  providers: readonly ShortcutRuntimeProviderDescriptor[]
  /** 系统级全局捕获能力 */
  global: ShortcutSourceAvailability
  /** 当前 App/页面聚焦时的局部捕获能力 */
  local: ShortcutSourceAvailability
}

type ShortcutSourceAvailability = Record<ShortcutInputSource, boolean>

type CreateShortcutRuntimeCapabilitiesOptions = {
  platform: ShortcutRuntimePlatform
  providers: readonly ShortcutRuntimeProviderDescriptor[]
  global: ShortcutScopeCapabilities
  local: ShortcutScopeCapabilities
}
