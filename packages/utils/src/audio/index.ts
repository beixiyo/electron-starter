/**
 * 通用音频工具
 */
import { getWebmOpusDuration } from './getWebmOpusDuration'

const AUDIO_DURATION_TIMEOUT_MS = 3000

/**
 * 从 Blob 计算音频时长（秒）
 *
 * WebM 音频按 Opus packet 解析；其它格式交给浏览器媒体元素读取元数据
 * 无法取得 WebM 时长时返回 `undefined`，其它媒体读取失败时 reject
 */
export async function getAudioDuration(blob: Blob): Promise<number | undefined> {
  if (isWebmBlob(blob))
    return getWebmOpusDuration(blob)

  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio')
    const url = URL.createObjectURL(blob)
    let durationSeekTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const cleanup = () => {
      audio.onloadedmetadata = null
      audio.ondurationchange = null
      audio.ontimeupdate = null
      audio.onerror = null
      if (durationSeekTimer != null)
        clearTimeout(durationSeekTimer)
      URL.revokeObjectURL(url)
      audio.removeAttribute('src')
      audio.load()
    }
    const resolveOnce = (duration: number | undefined) => {
      if (settled)
        return

      settled = true
      cleanup()
      resolve(duration)
    }
    const rejectOnce = (error: Error) => {
      if (settled)
        return

      settled = true
      cleanup()
      reject(error)
    }
    const resolveCurrentDuration = () => {
      if (Number.isFinite(audio.duration))
        resolveOnce(audio.duration)
    }
    const resolveInfinityDuration = () => {
      audio.ondurationchange = resolveCurrentDuration
      audio.ontimeupdate = resolveCurrentDuration
      if (durationSeekTimer != null)
        clearTimeout(durationSeekTimer)
      durationSeekTimer = setTimeout(() => {
        resolveOnce(undefined)
      }, AUDIO_DURATION_TIMEOUT_MS)

      try {
        audio.currentTime = Number.MAX_SAFE_INTEGER
      }
      catch {
        resolveOnce(undefined)
      }
    }

    durationSeekTimer = setTimeout(() => {
      resolveOnce(undefined)
    }, AUDIO_DURATION_TIMEOUT_MS)
    audio.preload = 'metadata'
    audio.src = url
    audio.onloadedmetadata = () => {
      const duration = audio.duration

      if (Number.isFinite(duration)) {
        resolveOnce(duration)
        return
      }

      if (duration === Infinity) {
        resolveInfinityDuration()
        return
      }

      resolveOnce(undefined)
    }
    audio.onerror = () => {
      rejectOnce(new Error('无法读取音频时长'))
    }
  })
}

function isWebmBlob(blob: Blob): boolean {
  return blob.type.toLowerCase().split(';', 1)[0] === 'audio/webm'
}
