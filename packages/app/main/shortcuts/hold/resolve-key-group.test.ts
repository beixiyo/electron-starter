/** 验证全局运行时将物理修饰键侧别解析为正确的 uiohook keycode */
import { UiohookKey } from 'uiohook-napi'
import { describe, expect, it } from 'vitest'
import { resolveKeyGroup } from './resolve-key-group'

describe('快捷键物理键组解析', () => {
  it('分别解析左右 Option', () => {
    expect(resolveKeyGroup('AltLeft')).toEqual([UiohookKey.Alt])
    expect(resolveKeyGroup('AltRight')).toEqual([UiohookKey.AltRight])
  })
})
