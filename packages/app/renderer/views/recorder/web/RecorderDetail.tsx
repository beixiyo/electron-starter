import type { RecorderRecordMetadata } from '../utils/storage'
import { formatDate } from '@jl-org/tool'
import { Audio, Message, Modal } from 'comps'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { recorderStorage } from '../utils/storage'

export interface RecorderDetailProps {
  recordId: string | null
  isOpen: boolean
  onClose: () => void
}

/**
 * 录屏详情查看弹窗
 */
export const RecorderDetail = memo<RecorderDetailProps>((props) => {
  const { t } = useTranslation('recorder')
  const { recordId, isOpen, onClose } = props
  const [metadata, setMetadata] = useState<RecorderRecordMetadata | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [, setDownloading] = useState(false)

  useEffect(() => {
    if (!isOpen || !recordId) {
      setMetadata(null)
      setBlobUrl(null)
      return
    }

    const loadRecord = async () => {
      setLoading(true)
      try {
        const record = await recorderStorage.getRecord(recordId)
        if (record) {
          setMetadata(record.metadata)
          const url = URL.createObjectURL(record.blob)
          setBlobUrl(url)
        }
      }
      catch (error) {
        console.error(`${t('recordDetail.loadFailed')}:`, error)
        Message.danger(t('recordDetail.loadFailedRetry'))
        onClose()
      }
      finally {
        setLoading(false)
      }
    }

    loadRecord()
  }, [isOpen, recordId, onClose])

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [blobUrl])

  const handleDownload = async () => {
    if (!metadata || !blobUrl)
      return

    setDownloading(true)
    try {
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${metadata.name}.${getFileExtension(metadata.mimeType)}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
    catch (error) {
      console.error(`${t('recordDetail.downloadFailed')}:`, error)
      Message.danger(t('recordDetail.downloadFailed'))
    }
    finally {
      setDownloading(false)
    }
  }

  const getFileExtension = (mimeType: string) => {
    if (mimeType.includes('webm'))
      return 'webm'
    if (mimeType.includes('mp4'))
      return 'mp4'
    if (mimeType.includes('audio'))
      return 'webm'
    return 'webm'
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024)
      return `${bytes} B`
    if (bytes < 1024 * 1024)
      return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const isAudio = metadata?.captureKind === 'audio'

  return (
    <Modal
      isOpen={ isOpen }
      onClose={ onClose }
      titleText={ metadata?.name || t('recordDetail.title') }
      width={ 800 }
      onOk={ handleDownload }
      okText={ t('recordDetail.download') }
      cancelText={ t('recordDetail.close') }
    >
      { loading
        ? <div className="py-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 dark:border-zinc-100"></div>
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              {' '}
              {t('recordDetail.loading')}
            </p>
          </div>

        : metadata && blobUrl
          ? <div className="space-y-4">
              {/* 视频/音频播放器 */ }
              { isAudio

                ? <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-900/50">
                    <Audio
                      className="w-full"
                      src={ blobUrl }
                      controls
                    />
                  </div>

                : <div className="aspect-video w-full rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-black/80">
                    <video
                      src={ blobUrl }
                      className="h-full w-full"
                      controls
                      playsInline
                    />
                  </div>}

              {/* 详细信息 */ }
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-500 dark:text-zinc-400">{t('recordDetail.type')}</span>
                  <span className="ml-2 text-zinc-900 dark:text-zinc-100">
                    {metadata?.captureKind === 'audio'
                      ? t('recordItem.audio')
                      : t('recordItem.video')}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 dark:text-zinc-400">{t('recordDetail.fileSize')}</span>
                  <span className="ml-2 text-zinc-900 dark:text-zinc-100">
                    { formatFileSize(metadata.size) }
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 dark:text-zinc-400">{t('recordDetail.createTime')}</span>
                  <span className="ml-2 text-zinc-900 dark:text-zinc-100">
                    { formatDate('yyyy-MM-dd HH:mm:ss', new Date(metadata.createdAt)) }
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 dark:text-zinc-400">{t('recordDetail.mimeType')}</span>
                  <span className="ml-2 text-zinc-900 dark:text-zinc-100">
                    { metadata.mimeType }
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-zinc-500 dark:text-zinc-400">{t('recordDetail.audioConfig')}</span>
                  <div className="mt-1 flex gap-2">
                    { metadata.systemAudio && (
                      <span className="px-2 py-0.5 rounded text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                        {t('recordItem.systemAudio')}
                      </span>
                    ) }
                    { metadata.micAudio && (
                      <span className="px-2 py-0.5 rounded text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                        {t('recordItem.microphone')}
                      </span>
                    ) }
                    { !metadata.systemAudio && !metadata.micAudio && (
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300">
                        {t('recordDetail.noAudio')}
                      </span>
                    ) }
                  </div>
                </div>
              </div>
            </div>
          : null }
    </Modal>
  )
})

RecorderDetail.displayName = 'RecorderDetail'
