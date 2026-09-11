import type { ShortcutBindings } from '@shared/shortcuts'
import {
  DEFAULT_BINDINGS,
  isShortcutGestureBindingSupportedByAction,
  normalizeShortcutBindings,
  normalizeShortcutBindingsOrThrow,
  resolveShortcutBindingConflicts,
  SHORTCUT_ACTIONS,
} from '@shared/shortcuts'
import { createMainDiagnosticLogger } from '../logging'
import { createStore } from '.'

const store = createStore<ShortcutBindings>('shortcut-bindings.json', DEFAULT_BINDINGS)
const SHORTCUT_ACTION_IDS: ReadonlySet<string> = new Set(SHORTCUT_ACTIONS.map(action => action.id))
const log = createMainDiagnosticLogger('storage')

export function readShortcutBindings(): ShortcutBindings {
  const raw = store.read()
  return finalizeShortcutBindings(restoreDroppedBindings(raw, normalizeShortcutBindings(raw)))
}

export function writeShortcutBindings(bindings: ShortcutBindings): void {
  store.write(bindings)
}

/** 校验 renderer 写入，并以 action 定义重建 scope */
export function normalizeShortcutBindingsForWrite(value: unknown): ShortcutBindings {
  assertKnownShortcutActionIds(value)
  return finalizeShortcutBindings(normalizeShortcutBindingsOrThrow(value))
}

/**
 * 归一失败的历史绑定回落默认值，而不是当成「用户主动禁用」
 *
 * {@link normalizeShortcutBindings} 对识别不了的 chord（旧版本写入、之后从规范键名空间里
 * 移除的键名等）返回 null，与用户主动禁用同形。不区分就会把它固化成禁用项：设置页下一次
 * 保存把 null 写回磁盘，这条快捷键永久消失。语义与下面 unsupported gesture 的回落一致，
 * 对将来任何一次 schema 收紧都成立
 */
function restoreDroppedBindings(
  raw: ShortcutBindings,
  normalized: ShortcutBindings,
): ShortcutBindings {
  const defaults: ShortcutBindings = DEFAULT_BINDINGS
  const restored: ShortcutBindings = { ...normalized }

  for (const [id, binding] of Object.entries(raw)) {
    if (!binding || restored[id])
      continue

    /** 回落是静默的，留一条结构化日志，否则用户只会看到「快捷键自己变了」 */
    log.warn('shortcut-bindings.normalize-failed', '快捷键绑定无法归一，已回落默认值', {
      actionId: id,
      binding,
    })
    restored[id] = defaults[id] ?? null
  }

  return restored
}

function finalizeShortcutBindings(normalized: ShortcutBindings): ShortcutBindings {
  const next: ShortcutBindings = { ...DEFAULT_BINDINGS }

  for (const action of SHORTCUT_ACTIONS) {
    if (!(action.id in normalized))
      continue

    const binding = normalized[action.id]
    next[action.id] = binding
      ? isShortcutGestureBindingSupportedByAction(action, binding)
        ? { ...binding, scope: action.scope }
        : DEFAULT_BINDINGS[action.id]
      : null
  }

  return resolveShortcutBindingConflicts(next)
}

function assertKnownShortcutActionIds(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Shortcut bindings must be an object')

  const unknownIds = Object.keys(value).filter(id => !SHORTCUT_ACTION_IDS.has(id))
  if (unknownIds.length > 0)
    throw new Error(`未知快捷键动作标识：${unknownIds.join(', ')}`)
}
