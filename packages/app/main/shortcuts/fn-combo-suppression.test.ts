/**
 * Fn 组合成员键的窗口内抑制：命中条件必须与运行时的 chord 匹配完全一致
 *
 * 两个方向的错判都会让用户莫名其妙：多吞（按下去既没动作、字符也没了）和漏吞
 * （动作触发了、字符照样打进输入框，也就是这个模块本该修掉的那个 bug）
 * 用例钉住两处真实缺口：只比主键不比 modifiers，以及 macOS 在 Fn 按住时
 * 把方向键翻译成 Home/End/PageUp/PageDown 导致键名对不上
 */

import type { ShortcutBinding } from '@shared/shortcuts'
import type { Input, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachFnComboSuppression, setFnComboSuppression } from './fn-combo-suppression'

const harness = vi.hoisted(() => ({
  listener: null as ((input: { phase: 'down' | 'up' | 'reset', key?: string }) => void) | null,
}))

vi.mock('./input', () => ({
  keyboardInputBackend: {
    subscribe: (listener: (input: unknown) => void) => {
      harness.listener = listener as never
      return () => {
        harness.listener = null
      }
    },
  },
}))

/** 收集 before-input-event 回调，返回「这次按键是否被吞」 */
function attachWindow(): (input: Partial<Input>) => boolean {
  let handler: ((event: { preventDefault: () => void }, input: Input) => void) | null = null
  const webContents = {
    on: (_channel: string, listener: typeof handler) => {
      handler = listener
    },
  } as unknown as WebContents

  attachFnComboSuppression(webContents)

  return (input) => {
    let prevented = false
    handler?.({ preventDefault: () => {
      prevented = true
    } }, { type: 'keyDown', ...input } as Input)
    return prevented
  }
}

function fnBinding(key: string, modifiers: ShortcutBinding['chord']['modifiers'] = []): ShortcutBinding {
  return {
    scope: 'global',
    gesture: 'press',
    chord: { source: 'fn', key, modifiers } as ShortcutBinding['chord'],
  }
}

function register(binding: ShortcutBinding, canTrigger = true): void {
  setFnComboSuppression(
    [{ id: 'recording', binding, onShortcut: vi.fn() }],
    () => canTrigger,
  )
}

describe('Fn 组合抑制', () => {
  beforeEach(() => {
    setFnComboSuppression([], () => false)
  })

  it('Fn 按住时吞掉绑定的组合成员键，松开后不再吞', () => {
    const send = attachWindow()
    register(fnBinding('Space'))

    expect(send({ code: 'Space', key: ' ' })).toBe(false)

    harness.listener?.({ phase: 'down', key: 'Fn' })
    expect(send({ code: 'Space', key: ' ' })).toBe(true)

    harness.listener?.({ phase: 'up', key: 'Fn' })
    expect(send({ code: 'Space', key: ' ' })).toBe(false)
  })

  it('多按一个 modifier 就不再是同一个绑定，不吞', () => {
    const send = attachWindow()
    register(fnBinding('Space'))
    harness.listener?.({ phase: 'down', key: 'Fn' })

    expect(send({ code: 'Space', key: ' ', shift: true })).toBe(false)
    expect(send({ code: 'Space', key: ' ' })).toBe(true)
  })

  it('绑定带 modifier 时，modifier 齐了才吞', () => {
    const send = attachWindow()
    register(fnBinding('Space', ['Shift']))
    harness.listener?.({ phase: 'down', key: 'Fn' })

    expect(send({ code: 'Space', key: ' ' })).toBe(false)
    expect(send({ code: 'Space', key: ' ', shift: true })).toBe(true)
  })

  it('方向键被 macOS 翻译成 Home 后仍然吞得掉', () => {
    const send = attachWindow()
    register(fnBinding('ArrowLeft'))
    harness.listener?.({ phase: 'down', key: 'Fn' })

    expect(send({ code: 'Home', key: 'Home' })).toBe(true)
  })

  it('Return 被 macOS 翻译成 NumpadEnter 后仍然吞得掉', () => {
    const send = attachWindow()
    register(fnBinding('Enter'))
    harness.listener?.({ phase: 'down', key: 'Fn' })

    expect(send({ code: 'NumpadEnter', key: 'Enter' })).toBe(true)
  })

  it('门禁不通过的绑定不吞键', () => {
    const send = attachWindow()
    register(fnBinding('Space'), false)
    harness.listener?.({ phase: 'down', key: 'Fn' })

    expect(send({ code: 'Space', key: ' ' })).toBe(false)
  })

  it('后端 reset 清掉 Fn 按住状态', () => {
    const send = attachWindow()
    register(fnBinding('Space'))
    harness.listener?.({ phase: 'down', key: 'Fn' })
    harness.listener?.({ phase: 'reset' })

    expect(send({ code: 'Space', key: ' ' })).toBe(false)
  })
})
