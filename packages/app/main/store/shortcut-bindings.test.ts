import type { ShortcutBindings } from '@shared/shortcuts'
import { DEFAULT_BINDINGS, normalizeShortcutBindings } from '@shared/shortcuts'
import { describe, expect, it, vi } from 'vitest'
import { normalizeShortcutBindingsForWrite, readShortcutBindings } from './shortcut-bindings'

const storedBindings = vi.hoisted(() => ({ value: {} as ShortcutBindings }))

/** 隔离磁盘：直接给出「磁盘上那份」内容，store 的读写路径不参与用例 */
vi.mock('@main/storage', () => ({
  getAppStorageAreaPath: () => '/tmp/electron-starter-test',
  readJsonFileSync: () => storedBindings.value,
  writeJsonFileSync: vi.fn(),
}))

vi.mock('../logging', () => ({
  createMainDiagnosticLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  }),
}))

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

describe('历史快捷键绑定读取', () => {
  /**
   * 键名空间收紧后，旧配置里的键名会整条归一失败
   *
   * 归一失败与「用户主动禁用」都是 null，不区分就会把它当禁用项固化：设置页下一次保存
   * 把 null 写回磁盘，这条快捷键永久消失。这里断言两件事——归一确实失败（回归的前提），
   * 以及读取结果回落到默认绑定而不是 null
   */
  it('归一失败的历史绑定回落默认值，用户主动禁用的保持禁用', () => {
    const legacy: ShortcutBindings = {
      ...DEFAULT_BINDINGS,
      /** 旧版本默认值用的是捕获后端私有键名，已不在规范键名空间内 */
      bookmark: { scope: 'global', gesture: 'press', chord: { source: 'fn', key: 'Grave' } } as never,
      recording: {
        scope: 'global',
        gesture: 'press',
        chord: { source: 'keyboard', key: 'Grave', modifiers: ['Primary'] },
      } as never,
      voiceDictation: null,
    }
    storedBindings.value = legacy

    /** 前提：这两条在归一层确实被丢掉，与禁用项同形 */
    const normalized = normalizeShortcutBindings(legacy)
    expect(normalized.bookmark).toBeNull()
    expect(normalized.recording).toBeNull()

    const bindings = readShortcutBindings()

    expect(bindings.bookmark).toEqual(DEFAULT_BINDINGS.bookmark)
    expect(bindings.recording).toEqual(DEFAULT_BINDINGS.recording)
    expect(bindings.voiceDictation).toBeNull()
  })
})
