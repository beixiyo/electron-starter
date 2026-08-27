import { downloadByData, downloadByUrl, formatDate } from '@jl-org/tool'
import { Button, Card, Message, Modal } from 'comps'
import { Clock, Download, HardDrive, Music, Play, Trash2, Video } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RecorderRecordMetadata } from '../utils/storage'
import { recorderStorage } from '../utils/storage'

export interface RecorderItemProps {
  metadata: RecorderRecordMetadata
  onDelete?: (id: string) => void
  onView?: (id: string) => void
}

/**
 * 单个录屏记录项卡片
 */
export const RecorderItem = memo<RecorderItemProps>((props) => {
  const { t } = useTranslation('recorder')
  const {
    metadata,
    onDelete,
    onView,
  } = props
  const [blobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [blobUrl])

  const handleDownload = async () => {
    if (blobUrl) {
      downloadByUrl(blobUrl, `${metadata.name}.${getFileExtension(metadata.mimeType)}`)
      return
    }

    setLoading(true)
    try {
      const blob = await recorderStorage.getBlob(metadata.id)
      if (blob) {
        downloadByData(blob, `${metadata.name}.${getFileExtension(metadata.mimeType)}`)
      }
    }
    catch (error) {
      console.error(`${t('recordItem.downloadFailed')}:`, error)
      Message.danger(t('recordItem.downloadFailed'))
    }
    finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    Modal.warning({
      titleText: t('recordItem.deleteConfirmTitle'),
      children: (
        <div>
          { t('recordItem.deleteConfirmContent', { name: metadata.name }) }
        </div>
      ),
      onOk: async () => {
        await recorderStorage.deleteRecord(metadata.id)
        onDelete?.(metadata.id)
      },
    })
  }

  const handleView = () => {
    onView?.(metadata.id)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const getFileExtension = (mimeType: string) => {
    if (mimeType.includes('webm')) return 'webm'
    if (mimeType.includes('mp4')) {
      return mimeType.includes('audio')
        ? 'm4a'
        : 'mp4'
    }
    if (mimeType.includes('ogg')) return 'ogg'
    return mimeType.includes('audio')
      ? 'webm'
      : 'webm'
  }

  const isAudio = metadata.captureKind === 'audio'
  const footer = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-4 text-xs text-text3">
        <div className="flex items-center gap-1">
          <Clock size={ 14 } />
          <span>{ formatDate('yyyy-MM-dd HH:mm', new Date(metadata.createdAt)) }</span>
        </div>
        <div className="flex items-center gap-1">
          <HardDrive size={ 14 } />
          <span>{ formatFileSize(metadata.size) }</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={ handleView }
          leftIcon={ <Play size={ 16 } /> }
        >
          { t('recordItem.view') }
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={ handleDownload }
          loading={ loading }
          leftIcon={ <Download size={ 16 } /> }
        >
          { t('recordItem.download') }
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={ handleDelete }
          leftIcon={ <Trash2 size={ 16 } /> }
        >
          { t('recordItem.delete') }
        </Button>
      </div>
    </div>
  )

  return (
    <Card
      bordered={ false }
      shadow="none"
      hoverEffect={ false }
      className="bg-background2 shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-colors hover:bg-background3"
      footer={ footer }
    >
      <div className="flex items-start gap-4">
        <div
          className={ `
          flex-shrink-0 w-16 h-16 rounded-lg flex items-center justify-center
          ${
            isAudio
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
          }
        ` }
        >
          { isAudio
            ? <Music size={ 32 } />
            : <Video size={ 32 } /> }
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="truncate text-base font-semibold text-text">
            { metadata.name }
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-text2">
            <span
              className={ `
              px-2 py-0.5 rounded text-xs font-medium
              ${
                isAudio
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              }
            ` }
            >
              { isAudio
                ? t('recordItem.audio')
                : t('recordItem.video') }
            </span>
            { metadata.systemAudio && (
              <span className="px-2 py-0.5 rounded text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                { t('recordItem.systemAudio') }
              </span>
            ) }
            { metadata.micAudio && (
              <span className="px-2 py-0.5 rounded text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                { t('recordItem.microphone') }
              </span>
            ) }
          </div>
        </div>
      </div>
    </Card>
  )
})

RecorderItem.displayName = 'RecorderItem'
