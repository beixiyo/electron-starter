import type { IpcContract } from '@ipc/core'
import type { FnComboKey, Modifier } from '@ipc/services/fn/contract'

export type { FnComboKey, Modifier }

export type ShortcutBinding
  = | { type: 'combo', key: FnComboKey, modifiers?: Modifier[] }
    | { type: 'doublePress' }
    | { type: 'hold' }
    | { type: 'hotkey', modifiers: Modifier[], key: string }

/** action id → 绑定，null 表示禁用 */
export type ShortcutBindings = Record<string, ShortcutBinding | null>

export const DEFAULT_BINDINGS: ShortcutBindings = {
  recording: { type: 'combo', key: 'Space' },
  askFlowtica: { type: 'doublePress' },
  voiceDictation: { type: 'hold' },
  bookmark: { type: 'combo', key: 'Grave' },
}

export type ShortcutConfigContract = IpcContract<{
  getBindings: () => ShortcutBindings
  setBindings: (bindings: ShortcutBindings) => void
  /** 录制快捷键前调用，阻止主进程响应 fn 事件 */
  pauseForRecord: () => void
  /** 录制结束后调用，恢复主进程响应 */
  resumeAfterRecord: () => void
}, {}>
