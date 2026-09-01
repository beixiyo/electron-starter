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

  it('恢复不符合 action 激活方式的历史手势', () => {
    const bindings = normalizeShortcutBindingsForWrite({
      voiceDictation: {
        scope: 'global',
        gesture: 'hold',
        chord: { source: 'fn', key: 'Fn' },
      },
    })

    expect(bindings.voiceDictation?.gesture).toBe('press')
  })

  it('保留可执行的右侧 Option 单键绑定', () => {
    const bindings = normalizeShortcutBindingsForWrite({
      voiceDictation: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'AltRight', modifiers: [] },
      },
    })

    expect(bindings.voiceDictation).toEqual({
      scope: 'global',
      gesture: 'press',
      chord: { source: 'keyboard', key: 'AltRight', modifiers: [] },
    })
  })

  it('拒绝物理 modifier 主键叠加当前平台等价的 Primary', () => {
    const key = process.platform === 'darwin'
      ? 'MetaRight'
      : 'ControlRight'

    expect(() => normalizeShortcutBindingsForWrite({
      voiceDictation: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key, modifiers: ['Primary'] },
      },
    })).toThrow('voiceDictation')
  })

  it('拒绝 Primary 与当前平台逻辑 modifier 重复声明同一家族', () => {
    const logicalModifier = process.platform === 'darwin'
      ? 'Meta'
      : 'Control'

    expect(() => normalizeShortcutBindingsForWrite({
      voiceDictation: {
        scope: 'global',
        gesture: 'press',
        chord: {
          source: 'keyboard',
          key: 'A',
          modifiers: ['Primary', logicalModifier],
        },
      },
    })).toThrow('voiceDictation')
  })
})
