import type { RecorderRecordMetadata } from '../utils/storage'
import { Message } from 'comps'
import { FolderOpen } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'
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
    setRecords(prev => prev.filter(r => r.id !== id))
  }

  const handleView = (id: string) => {
    onViewRecord?.(id)
  }

  const wrapperClass = useMemo(() => cn('space-y-4', className), [className])

  if (loading) {
    return (
      <div className={ wrapperClass }>
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 dark:border-zinc-100"></div>
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{ t('recordList.loading') }</p>
        </div>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className={ wrapperClass }>
        <div className="text-center py-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg">
          <FolderOpen className="mx-auto h-12 w-12 text-zinc-400 dark:text-zinc-600" />
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{ t('recordList.noRecords') }</p>
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">{ t('recordList.noRecordsDesc') }</p>
        </div>
      </div>
    )
  }

  return (
    <div className={ wrapperClass }>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          { t('recordList.savedRecords') }
          {' '}
          (
          { records.length }
          )
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-4">
        { records.map(record => (
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
