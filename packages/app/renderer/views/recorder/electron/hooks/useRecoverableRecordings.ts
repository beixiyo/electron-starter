import { Message } from 'comps'
import { useLatestCallback } from 'hooks'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { recorderStorage } from '../../utils/storage'

/**
 * 启动录音页时把 main 恢复目录中的崩溃残留安全导入 IndexedDB
 */
export function useRecoverableRecordings(onRecovered?: (count: number) => void): void {
  const { t } = useTranslation('recorder')
  const handleRecovered = useLatestCallback((count: number) => onRecovered?.(count))

  useEffect(() => {
    let disposed = false

    async function recover(): Promise<void> {
      const recordings = await $ipc.recording.listRecoverableRecordings()
      let recoveredCount = 0

      for (const recording of recordings) {
        if (disposed) return

        try {
          const buffer = await $ipc.recording.readRecordingFile(recording.taskId)
          const blob = new Blob([buffer], { type: recording.mimeType })

          await recorderStorage.saveRecord(blob, {
            id: recording.taskId,
            name: recording.name,
            captureKind: 'audio',
            systemAudio: recording.systemAudio,
            micAudio: recording.micAudio,
            duration: 0,
          })
          await $ipc.recording.deleteRecordingFile(recording.taskId)
          recoveredCount += 1
        }
        catch (error) {
          console.error('[recording-recovery] import failed:', error)
        }
      }

      if (!disposed && recoveredCount > 0) {
        Message.success(t('recordError.recovered'))
        handleRecovered(recoveredCount)
      }
    }

    void recover().catch((error) => {
      console.error('[recording-recovery] scan failed:', error)
    })

    return () => {
      disposed = true
    }
  }, [handleRecovered, t])
}
