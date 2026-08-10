import type { ShortcutBindings } from '@shared/shortcuts'
import type { ShortcutRuntimeHandlers } from './runtime-backend'
import { resolveRuntimeShortcutBindings } from './capabilities'
import { fnShortcutRuntimeBackend } from './fn'
import { keyboardShortcutRuntimeBackend } from './global'
import { createShortcutRuntimeBackendContext } from './runtime-backend'
import { canTriggerShortcutBinding } from './scope'

export type { ShortcutRuntimeHandlers } from './runtime-backend'

const SHORTCUT_RUNTIME_BACKENDS = [
  fnShortcutRuntimeBackend,
  keyboardShortcutRuntimeBackend,
]

/** 按当前权限、平台和持久化配置重新注册所有快捷键 backend */
export function reapplyShortcutRuntime(
  bindings: ShortcutBindings,
  handlers: ShortcutRuntimeHandlers,
): void {
  const runtimeBindings = resolveRuntimeShortcutBindings(bindings)
  const context = createShortcutRuntimeBackendContext(handlers, canTriggerShortcutBinding)

  for (const backend of SHORTCUT_RUNTIME_BACKENDS)
    backend.reset()
  for (const backend of SHORTCUT_RUNTIME_BACKENDS)
    backend.apply(runtimeBindings, context)

  for (const backend of SHORTCUT_RUNTIME_BACKENDS)
    backend.sync?.()
}
