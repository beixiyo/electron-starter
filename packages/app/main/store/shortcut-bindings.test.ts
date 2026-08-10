import { describe, expect, it } from 'vitest'
import { normalizeShortcutBindingsForWrite } from './shortcut-bindings'

describe('快捷键绑定持久化边界', () => {
  it('始终恢复动作声明的作用域', () => {
    const bindings = normalizeShortcutBindingsForWrite({
      recording: {
        scope: 'local',
        gesture: 'press',
        chord: {
          source: 'keyboard',
          key: 'R',
          modifiers: ['Primary'],
        },
      },
    })

    expect(bindings.recording?.scope).toBe('global')
    expect(bindings.recording?.chord).toEqual({
      source: 'keyboard',
      key: 'R',
      modifiers: ['Primary'],
    })
  })

  it('在写入归一化边界拒绝未知动作标识', () => {
    expect(() => normalizeShortcutBindingsForWrite({
      recording: null,
      injectedAction: {
        scope: 'local',
        gesture: 'press',
        chord: {
          source: 'keyboard',
          key: 'KeyX',
          modifiers: [],
        },
      },
    })).toThrow('未知快捷键动作标识：injectedAction')
  })
})
