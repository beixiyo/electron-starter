import { Message } from 'comps'
import { FolderOpen } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'
import type { RecorderRecordMetadata } from '../utils/storage'
import { recorderStorage } from '../utils/storage'
import { RecorderItem } from './RecorderItem'

export interface RecorderListProps {
  onViewRecord?: (id: string) => void
  refreshKey?: number
  /**
   * 自定义容器类名
   */
  className?: string
}

/**
 * 录屏记录列表组件
 */
export const RecorderList = memo<RecorderListProps>((props) => {
  const { t } = useTranslation('recorder')
  const {
    onViewRecord,
    refreshKey,
    className,
  } = props
  const [records, setRecords] = useState<RecorderRecordMetadata[]>([])
  const [loading, setLoading] = useState(false)

  const loadRecords = useCallback(async () => {
    try {
      const metadataList = await recorderStorage.getAllMetadata()
      setRecords(metadataList)
    }
    catch (error) {
      console.error('加载录屏列表失败:', error)
      Message.danger(t('messages.loadFailedRetry'))
    }
    finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    setLoading(true)
    loadRecords()
  }, [loadRecords])

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      loadRecords()
    }
  }, [refreshKey, loadRecords])

  const handleDelete = (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id))
  }

  const handleView = (id: string) => {
    onViewRecord?.(id)
  }

  const wrapperClass = useMemo(() => cn('space-y-4', className), [className])

  if (loading) {
    return (
      <div className={ wrapperClass }>
        <div className="py-12 text-center">
          <div className="inline-block size-8 animate-spin rounded-full border-b-2 border-text" />
          <p className="mt-4 text-sm text-text3">{ t('recordList.loading') }</p>
        </div>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className={ wrapperClass }>
        <div className="rounded-2xl bg-background2 py-12 text-center shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
          <FolderOpen className="mx-auto size-12 text-text4" />
          <p className="mt-4 text-sm text-text3">{ t('recordList.noRecords') }</p>
          <p className="mt-2 text-xs text-text4">{ t('recordList.noRecordsDesc') }</p>
        </div>
      </div>
    )
  }

  return (
    <div className={ wrapperClass }>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-text">
          { t('recordList.savedRecords') } (
          { records.length }
          )
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-4">
        { records.map((record) => (
          <RecorderItem
            key={ record.id }
            metadata={ record }
            onDelete={ handleDelete }
            onView={ handleView }
          />
        )) }
      </div>
    </div>
  )
})

RecorderList.displayName = 'RecorderList'
