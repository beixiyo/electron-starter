import type {
  ShortcutBinding,
  ShortcutBindings,
  ShortcutGestureType,
  ShortcutInputSource,
  ShortcutRuntimeCapabilities,
  ShortcutRuntimeProviderDescriptor,
  ShortcutScope,
} from './types'
import { SHORTCUT_GESTURES } from './types'

export const WEB_SHORTCUT_CAPABILITIES: ShortcutRuntimeCapabilities = {
  platform: 'web',
  providers: [
    { id: 'dom-keyboard', source: 'keyboard', scopes: ['local'] },
  ],
  scopes: {
    global: {
      keyboard: [],
      fn: [],
    },
    local: {
      keyboard: [...SHORTCUT_GESTURES],
      fn: [],
    },
  },
}

export function createElectronShortcutCapabilities(options: CreateElectronShortcutCapabilitiesOptions): ShortcutRuntimeCapabilities {
  return {
    platform: 'electron',
    providers: options.providers,
    scopes: {
      global: {
        keyboard: toSupportedGestures(options.global.keyboard),
        fn: toSupportedGestures(options.global.fn),
      },
      local: {
        keyboard: toSupportedGestures(options.local.keyboard),
        fn: toSupportedGestures(options.local.fn),
      },
    },
  }
}

export function isShortcutBindingSupported(
  binding: ShortcutBinding,
  capabilities: ShortcutRuntimeCapabilities,
): boolean {
  return capabilities.scopes[binding.scope][binding.chord.source].includes(binding.gesture)
}

/**
 * 计算 binding 在当前能力下真正生效的 scope。
 *
 * 声明为 `global` 但系统级捕获不可用时（如 macOS 未授予辅助功能）降级为 `local`，
 * 由窗口内 DOM backend 接管，聚焦时仍可用；两个 scope 都不可用才返回 null
 */
export function resolveEffectiveShortcutScope(
  binding: ShortcutBinding,
  capabilities: ShortcutRuntimeCapabilities,
): ShortcutScope | null {
  const candidates: ShortcutScope[] = binding.scope === 'global'
    ? ['global', 'local']
    : ['local']

  return candidates.find(scope => (
    capabilities.scopes[scope][binding.chord.source].includes(binding.gesture)
  )) ?? null
}

/**
 * 把持久化 binding 映射为运行时实际生效的 binding，scope 被改写为降级后的实际值。
 *
 * 只用于运行时注册，不可写回持久化：权限恢复后声明 scope 仍要能重新升回 global
 */
export function toEffectiveShortcutBindings(
  bindings: ShortcutBindings,
  capabilities: ShortcutRuntimeCapabilities,
): ShortcutBindings {
  return Object.fromEntries(
    Object.entries(bindings).map(([id, binding]) => {
      if (!binding)
        return [id, null]

      const scope = resolveEffectiveShortcutScope(binding, capabilities)
      return [
        id,
        scope
          ? scope === binding.scope
            ? binding
            : { ...binding, scope }
          : null,
      ]
    }),
  )
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

function toSupportedGestures(canUse: boolean): readonly ShortcutGestureType[] {
  return canUse
    ? SHORTCUT_GESTURES
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
