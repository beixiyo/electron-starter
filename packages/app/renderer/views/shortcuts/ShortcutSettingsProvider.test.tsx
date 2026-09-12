// @vitest-environment jsdom
/** 验证真实录制宿主的保存失败重试与异步会话释放，不替换录制引擎或 DOM 事件适配 */
import type { Root } from 'react-dom/client'
import type { ShortcutRecordSession } from '@/shortcuts/shortcutConfigAdapter'
import type { ShortcutActionRow } from './ShortcutSettingsProvider'
import { DEFAULT_KEYBOARD_BINDINGS } from '@shared/shortcuts'
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pauseShortcutRecord, resumeShortcutRecord, setShortcutBindings } from '@/shortcuts/shortcutConfigAdapter'
import { ShortcutSettingsProvider, useShortcutActionRow } from './ShortcutSettingsProvider'

vi.mock('@/shortcuts/shortcutConfigAdapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/shortcuts/shortcutConfigAdapter')>(),
  getShortcutBindings: vi.fn(async () => DEFAULT_KEYBOARD_BINDINGS),
  getShortcutDefaultBindings: vi.fn(async () => DEFAULT_KEYBOARD_BINDINGS),
  setShortcutBindings: vi.fn(async () => {}),
  pauseShortcutRecord: vi.fn(async () => ({ nativeCapture: false, systemShortcuts: [] })),
  resumeShortcutRecord: vi.fn(async () => {}),
}))

let root: Root
let row: ShortcutActionRow
let container: HTMLDivElement

function Probe() {
  row = useShortcutActionRow('recording')!
  return null
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<StrictMode><ShortcutSettingsProvider><Probe /></ShortcutSettingsProvider></StrictMode>))
  expect(row.ready).toBe(true)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('快捷键录制宿主', () => {
  it('保存失败保留旧绑定并允许继续录制，下一次成功只写入一次', async () => {
    const original = row.action.binding
    vi.mocked(setShortcutBindings).mockRejectedValueOnce(new Error('disk unavailable'))
    await act(async () => row.startRecord())
    await act(async () => pressModifiedKey('KeyQ', 'q'))
    expect(row.saveError).toBe(true)
    expect(row.isRecording).toBe(true)
    expect(row.action.binding).toEqual(original)

    await act(async () => pressModifiedKey('KeyW', 'w'))
    expect(row.saveError).toBe(false)
    expect(row.isRecording).toBe(false)
    expect(row.action.binding?.chord.key).toBe('W')
    expect(setShortcutBindings).toHaveBeenCalledTimes(2)
  })

  it('卸载后立即重挂页面时，旧会话释放不能落在新会话开启之后', async () => {
    let finish!: (session: ShortcutRecordSession) => void
    const order: string[] = []
    vi.mocked(pauseShortcutRecord).mockImplementationOnce(() => {
      order.push('pause:first')
      return new Promise(resolve => { finish = resolve })
    }).mockImplementationOnce(async () => {
      order.push('pause:second')
      return { nativeCapture: false, systemShortcuts: [] }
    })
    vi.mocked(resumeShortcutRecord).mockImplementationOnce(async () => { order.push('resume:first') })

    await act(async () => row.startRecord())
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(<ShortcutSettingsProvider><Probe /></ShortcutSettingsProvider>))
    await act(async () => row.startRecord())
    await act(async () => finish({ nativeCapture: false, systemShortcuts: [] }))

    expect(order).toEqual(['pause:first', 'resume:first', 'pause:second'])
    expect(row.isRecording).toBe(true)
    expect(row.pending).toBe(false)
  })

  it('pending 开始被取消后先释放旧会话，再开启新录制', async () => {
    let finish!: (session: ShortcutRecordSession) => void
    const order: string[] = []
    vi.mocked(pauseShortcutRecord).mockImplementationOnce(() => {
      order.push('pause:first')
      return new Promise(resolve => { finish = resolve })
    }).mockImplementationOnce(async () => {
      order.push('pause:second')
      return { nativeCapture: false, systemShortcuts: [] }
    })
    vi.mocked(resumeShortcutRecord).mockImplementationOnce(async () => { order.push('resume:first') })

    await act(async () => row.startRecord())
    expect(row.pending).toBe(true)
    await act(async () => {
      row.cancelRecord()
      row.startRecord()
    })
    await act(async () => finish({ nativeCapture: false, systemShortcuts: [] }))

    expect(order).toEqual(['pause:first', 'resume:first', 'pause:second'])
    expect(row.isRecording).toBe(true)
    expect(row.pending).toBe(false)
  })
})

function pressModifiedKey(code: string, key: string): void {
  const dispatch = (type: string, keyCode: string, keyName: string, ctrlKey: boolean, altKey: boolean) => {
    window.dispatchEvent(new KeyboardEvent(type, { code: keyCode, key: keyName, ctrlKey, altKey, bubbles: true, cancelable: true }))
  }
  dispatch('keydown', 'ControlLeft', 'Control', true, false)
  dispatch('keydown', 'AltLeft', 'Alt', true, true)
  dispatch('keydown', code, key, true, true)
  dispatch('keyup', code, key, true, true)
  dispatch('keyup', 'AltLeft', 'Alt', true, false)
  dispatch('keyup', 'ControlLeft', 'Control', false, false)
}
