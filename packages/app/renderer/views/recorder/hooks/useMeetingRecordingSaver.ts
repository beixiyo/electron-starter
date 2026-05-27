import { useLatestCallback } from 'hooks'
import { useEffect } from 'react'
import { recorderStorage } from '../utils/storage'

/**
 * 监听会议录制完成事件，自动保存到 RecorderStorage（IndexedDB）。
 * 在 recorder 页面挂载此 hook。
 */
export function useMeetingRecordingSaver(onSaved?: () => void) {
  const handleSaved = useLatestCallback(() => {
    onSaved?.()
  })

  useEffect(() => {
    const unsub = $ipc.meetingDetection.on('recording-complete', async (payload) => {
      try {
        const buffer = await $ipc.meetingDetection.readRecordingFile(payload.path)
        const blob = new Blob([buffer], { type: payload.mimeType })

        await recorderStorage.saveRecord(blob, {
          name: payload.name,
          captureKind: 'audio',
          systemAudio: true,
          micAudio: true,
          duration: Math.round(payload.duration * 1000),
        })

        await $ipc.meetingDetection.deleteRecordingFile(payload.path)
        console.log(`[meeting-recording] saved to IndexedDB: ${payload.name}`)
        handleSaved()
      }
      catch (err) {
        console.error('[meeting-recording] save failed:', err)
      }
    })

    return unsub
  }, [])
}
