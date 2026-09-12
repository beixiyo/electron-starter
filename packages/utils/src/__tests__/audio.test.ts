import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAudioDuration } from '../audio'
import { getWebmOpusDuration } from '../audio/getWebmOpusDuration'

describe('音频时长解析', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('无效 WebM 输入返回 undefined', async () => {
    const invalidWebm = new Blob(['not a WebM stream'], { type: 'audio/webm;codecs=opus' })

    await expect(getWebmOpusDuration(invalidWebm)).resolves.toBeUndefined()
  })

  it('没有 Duration/Cues 时按 Opus packet 的编码时长累计', async () => {
    /**
     * 该 fixture 由 ffmpeg live WebM 生成，并用 ffprobe 核对 12 个 packet 各为 20ms
     * Segment 没有 Duration/Cues，解析结果只能来自实际 packet 内容
     */
    const webm = blobFromBase64(OPUS_WEBM_WITHOUT_DURATION)

    await expect(getWebmOpusDuration(webm)).resolves.toBeCloseTo(0.24, 6)
  })

  it('媒体事件重复触发时只结算一次并清理资源', async () => {
    const loadedMetadataHandlers: Array<(() => void) | null> = []
    const audio = {
      duration: 12.5,
      load: vi.fn(),
      removeAttribute: vi.fn(),
      preload: '',
      src: '',
      ondurationchange: null,
      onerror: null,
      onloadedmetadata: null,
      ontimeupdate: null,
    } as unknown as HTMLAudioElement
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()

    vi.spyOn(document, 'createElement').mockImplementation(() => {
      return audio
    })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    const durationPromise = getAudioDuration(new Blob(['audio'], { type: 'audio/ogg' }))
    loadedMetadataHandlers.push(audio.onloadedmetadata as (() => void) | null)

    loadedMetadataHandlers[0]?.()
    loadedMetadataHandlers[0]?.()

    await expect(durationPromise).resolves.toBe(12.5)
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(audio.removeAttribute).toHaveBeenCalledOnce()
    expect(audio.load).toHaveBeenCalledOnce()
  })

  it('媒体元素不发送事件时也会在超时后清理资源', async () => {
    vi.useFakeTimers()

    const audio = {
      duration: NaN,
      load: vi.fn(),
      removeAttribute: vi.fn(),
      preload: '',
      src: '',
      ondurationchange: null,
      onerror: null,
      onloadedmetadata: null,
      ontimeupdate: null,
    } as unknown as HTMLAudioElement
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()

    vi.spyOn(document, 'createElement').mockImplementation(() => audio)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    const settled = vi.fn()
    void getAudioDuration(new Blob(['audio'], { type: 'audio/ogg' })).then(settled)

    await vi.advanceTimersByTimeAsync(3001)

    expect(settled).toHaveBeenCalledWith(undefined)
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(audio.removeAttribute).toHaveBeenCalledOnce()
    expect(audio.load).toHaveBeenCalledOnce()
  })
})

function blobFromBase64(base64: string): Blob {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: 'audio/webm;codecs=opus' })
}

const OPUS_WEBM_WITHOUT_DURATION = `
GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHNTbuMU6uEElTDZ1OsggE37AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmpyrXsYMPQkBNgI1MYXZmNjIuMTIuMTAwV0GNTGF2ZjYyLjEyLjEwMBZUrmvlrgEAAAAAAABc14EBc8WIS5Jo5eBNc5CcgQAitZyDdW5kiIEAhoZBX09QVVNWqoNjLqBWu4QExLQAg4EC4ZGfgQG1iEDncAAAAAAAYmSBEGOik09wdXNIZWFkAQE4AYC7AAAAAAASVMNn2XNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTIuMTAwc3OzY8CLY8WIS5Jo5eBNc5BnyKJFo4dFTkNPREVSRIeVTGF2YzYyLjI4LjEwMCBsaWJvcHVzH0O2dUOb54EAo+mBAACAeIJZosfzllfqtmAAAGI8qUBpqBjnzKpT8aIRt+J4WApnih8IvjmryJhrze5QyVrj0ncUoEaAwcI22UkjpW1LtIadvg5Tbv8BwzvhIUn3MdHz++Hr8VGzxTeZrBT+QINoWnlAcr6jy4EAFYB4nF4iFk8gujlqUoKkHHo4W7oDxjFKPfqIzcG2N8ar5XsxncXwjUlo49XUSC0bwsbqQG8j9+K4OD5/x/iI2+s2Toq5KruNsKPIgQApgHiaJdMsQT3hFCJqqCHWL/zRcZSMbGaN6CB6BJZbYLT+xdrHg4vs+1CNpuKrzXLb8TdTNlak3hbB/KaHy31mz5VJ1V/2o8mBAD2AeJm/L6RBF/Y+izEk4Cp9bN/vzcEtdROrkzitimcX1B3D/kZttDqmrGUSFmtrkT/CT8uy37DONv6JRHy31mz5VJ0qu432o8eBAFGAeJm/L6RBF/Y+izEZf5nZJ6w2R/YoiSPebS8ub5kwhzm4wDCB+rbCx4spOSMw6wm0K9vYS67+iUR8t9Zs+VSdKruNtqPGgQBlgHiZvy+kQRf2PosxDgGRdX24WufHRMyf0T8PmkRrb7gL4pOA5QiTBvK0iNiq8ea4fDiPUlAfymkRt9Zs+VSdKruN/qPFgQB5gHiZvy+kQRf2PosxGI0seefn3ztkaENgKgLDRuwj9AhA3c1zghU8N0yMMOpBlrSIiBKX6g/lNIjb6zZOirkqu432o8uBAI2AeJm/L6RBF/Y+izEOYr8/qT87c0mby2wy9OxWmqLLTXLgKkoRoLGHM+/ctnR7BjWLu4xPYQLw2+/xwoxIPlvrNk6KuSq7jbajyYEAoYB4mb8vpEEX9j6LMQK9HrdQRuWRNqBij1ATtEA02z+9cmaiJOkzK5Z9yaihDClRQkFKJLezDCjFMMp2PlvrNk6KuSq7jfajyIEAtYBomb8vpEEX9j6LMQ4esqTN7zAj0IiczMMlRl4aqzPBrIR9MzFVW7pTSMdBaRjZWKFJdEdzscO6jKdt231mzHbzSq7jfqPGgQDJgGiZvy+kQRf2PosxDlQzsE+4dow/9GjGG+2kKSl1IJJMrdXjqnP6r92ET7cHYXsA8FjPJeRvOJq0u31mzHPoyq7jdqPHgQDdgGiZvy+kQRf2PosxGXP4vuEjDdje/MSyQr4CbVKL7tU47ZhoxijvkC5F3p77nW18QqWqts4YPQynbdt9Zsxz6Mqu43Y=\n`
