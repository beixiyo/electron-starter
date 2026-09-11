/** runtime backend 契约：调度器与各 backend 之间的注册、派发接口 */

import type {
  ShortcutBinding,
  ShortcutBindings,
  ShortcutRuntimeEvent,
} from '@shared/shortcuts'

/** action id -> 快捷键 runtime 事件处理器 */
export type ShortcutRuntimeHandlers = Partial<Record<string, (event: ShortcutRuntimeEvent) => void>>

/**
 * 单个快捷键 runtime backend
 *
 * backend 按自己的规则认领 binding 并接到某个捕获实现上；它与 capabilities 里的
 * provider 声明解耦：一个 backend 可以同时服务多个 provider（系统级输入同时认领
 * Fn 与全局 keyboard）
 */
export type ShortcutRuntimeBackend = {
  readonly id: string
  /** 清理该 backend 现有注册和运行态 */
  reset: () => void
  /** 注册项就绪后按当前外部状态同步底层资源，例如 native helper 启停 */
  sync?: () => void
  /** 根据已过滤的 binding 重新注册该 backend */
  apply: (bindings: ShortcutBindings, context: ShortcutRuntimeBackendContext) => void
}

/** runtime 调度器提供给 backend 的共享能力 */
export type ShortcutRuntimeBackendContext = {
  /** 根据 action id 取得业务处理器 */
  getHandler: (id: string) => ((event: ShortcutRuntimeEvent) => void) | undefined
  /** 最终触发前的权限、scope 和 backend 可用性门禁 */
  canTrigger: (binding: ShortcutBinding) => boolean
  /** 派发统一 runtime 事件 */
  emit: (options: EmitShortcutRuntimeEventOptions) => void
}

/** 已匹配到 handler 的 runtime 注册项 */
export type ShortcutRuntimeEntry<T extends ShortcutBinding = ShortcutBinding> = {
  /** action id */
  id: string
  /** 持久化 binding */
  binding: T
  /** action 处理器 */
  onShortcut: (event: ShortcutRuntimeEvent) => void
}

export function createShortcutRuntimeBackendContext(
  handlers: ShortcutRuntimeHandlers,
  canTrigger: (binding: ShortcutBinding) => boolean,
): ShortcutRuntimeBackendContext {
  return {
    getHandler: id => handlers[id],
    canTrigger,
    emit: emitShortcutRuntimeEvent,
  }
}

export function getShortcutRuntimeEntries<T extends ShortcutBinding>(
  bindings: ShortcutBindings,
  context: ShortcutRuntimeBackendContext,
  predicate: (binding: ShortcutBinding | null) => binding is T,
): ShortcutRuntimeEntry<T>[] {
  return Object.entries(bindings).flatMap(([id, binding]) => {
    if (!predicate(binding))
      return []

    const onShortcut = context.getHandler(id)
    if (!onShortcut)
      return []

    return [{ id, binding, onShortcut }]
  })
}

function emitShortcutRuntimeEvent(options: EmitShortcutRuntimeEventOptions): void {
  const {
    id,
    phase,
    gesture,
    binding,
    onShortcut,
  } = options

  onShortcut({
    id,
    phase,
    gesture,
    binding,
  })
}

type EmitShortcutRuntimeEventOptions = ShortcutRuntimeEntry & Pick<
  ShortcutRuntimeEvent,
  'phase' | 'gesture'
>
