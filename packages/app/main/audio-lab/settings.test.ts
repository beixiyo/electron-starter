import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/store', () => ({
  createStore: (_filename: string, defaults: object) => ({
    read: () => defaults,
    write: vi.fn(),
  }),
}))

describe('audio lab settings module', () => {
  it('模块初始化时即可规范化持久化设置，不依赖尚未初始化的常量', async () => {
    const settings = await import('./settings')

    expect(settings.getAudioLabSettings()).toEqual(settings.DEFAULT_AUDIO_LAB_SETTINGS)
  })
})
