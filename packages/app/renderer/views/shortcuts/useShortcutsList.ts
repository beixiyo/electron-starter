import { getShortcutBindings, getShortcutDefaultBindings, setShortcutBindings } from '@/shortcuts/shortcutConfigAdapter'
import { shortcutBindingsConflict } from '@shared/shortcuts'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import type { ShortcutAction, ShortcutBinding } from './types'
import { DEFAULT_ACTIONS } from './types'

/** 读取、编辑并串行持久化快捷键动作列表。 */
export function useShortcutsList() {
  const [defaultActions, setDefaultActions] = useState<ShortcutAction[]>(() => cloneActions(DEFAULT_ACTIONS))
  const [actions, setActions] = useState<ShortcutAction[]>(() => cloneActions(DEFAULT_ACTIONS))
  const [ready, setReady] = useState(false)
  const [saveErrorActionId, setSaveErrorActionId] = useState<string | null>(null)
  const actionsRef = useRef(actions)
  const defaultActionsRef = useRef(defaultActions)
  const writeTailRef = useRef(Promise.resolve())

  actionsRef.current = actions
  defaultActionsRef.current = defaultActions

  useEffect(() => {
    let disposed = false

    Promise.all([getShortcutDefaultBindings(), getShortcutBindings()]).then(([defaultBindings, bindings]) => {
      if (disposed) return

      const nextDefaults = DEFAULT_ACTIONS.map((action) => ({
        ...action,
        binding: action.id in defaultBindings
          ? defaultBindings[action.id]
          : action.binding,
      }))
      const nextActions = nextDefaults.map((action) => ({
        ...action,
        binding: action.id in bindings
          ? bindings[action.id]
          : action.binding,
      }))

      defaultActionsRef.current = nextDefaults
      actionsRef.current = nextActions
      setDefaultActions(nextDefaults)
      setActions(nextActions)
      setReady(true)
    }).catch(() => {
      /** 未完成读取前保持不可编辑，避免用默认值覆盖无法读取的配置 */
    })

    return () => {
      disposed = true
    }
  }, [])

  /** 录制校验已挡住冲突，这里只替换目标动作，避免静默清空其他动作。 */
  const replaceBinding = useLatestCallback((id: string, binding: ShortcutBinding): Promise<boolean> => {
    if (!ready) return Promise.resolve(false)

    return enqueueWrite({
      actionId: id,
      update: (current) =>
        current.map((action) =>
          action.id === id
            ? { ...action, binding }
            : action
        ),
    })
  })

  const clearBinding = useLatestCallback((id: string): Promise<boolean> => {
    if (!ready) return Promise.resolve(false)

    return enqueueWrite({
      actionId: id,
      update: (current) =>
        current.map((action) =>
          action.id === id
            ? { ...action, binding: null }
            : action
        ),
    })
  })

  /** 恢复默认值允许抢占冲突项，这是唯一保留该行为的入口。 */
  const resetToDefault = useLatestCallback((id: string): Promise<boolean> => {
    if (!ready) return Promise.resolve(false)

    return enqueueWrite({
      actionId: id,
      update: (current) => {
        const restored = defaultActionsRef.current.find((action) => action.id === id)?.binding ?? null
        return current.map((action) => {
          if (action.id === id) return { ...action, binding: restored }
          if (restored && action.binding && action.id !== id && shortcutBindingsConflict(restored, action.binding)) return { ...action, binding: null }
          return action
        })
      },
    })
  })

  const enqueueWrite = useLatestCallback((request: WriteRequest): Promise<boolean> => {
    const task = writeTailRef.current.then(async () => {
      const next = request.update(actionsRef.current)
      try {
        await setShortcutBindings(toBindingMap(next))
      }
      catch {
        setSaveErrorActionId(request.actionId)
        return false
      }

      actionsRef.current = next
      setActions(next)
      setSaveErrorActionId(null)
      return true
    }, () => false)

    writeTailRef.current = task.then(() => undefined, () => undefined)
    return task
  })

  return {
    actions,
    defaultActions,
    ready,
    saveErrorActionId,
    replaceBinding,
    clearBinding,
    resetToDefault,
  }
}

function cloneActions(actions: ShortcutAction[]): ShortcutAction[] {
  return actions.map((action) => ({
    ...action,
    supportedGestures: [...action.supportedGestures],
  }))
}

function toBindingMap(actions: ShortcutAction[]): Record<string, ShortcutBinding | null> {
  return Object.fromEntries(actions.map((action) => [action.id, action.binding]))
}

type WriteRequest = {
  actionId: string
  update: (actions: ShortcutAction[]) => ShortcutAction[]
}
