import type { DesktopSourceInfo } from '../../utils/fetchDesktopSources'

type HelperText = {
  cannotSwitch: string
  noPreview: string
  noDisplayId: string
  supportsSystemAudio: string
  microphoneAudioOnly: string
}

type EmptyStateText = {
  loading: string
  empty: string
}

type RefreshConfig = {
  label: string
  loading: boolean
  onClick: () => void | Promise<any>
}

/**
 * 桌面源列表 Props
 */
export type SourceGridProps = {
  title: string
  sources: DesktopSourceInfo[]
  selectedSourceId?: string
  canSelect: boolean
  onSelect: (sourceId: string) => void
  emptyState: EmptyStateText
  refresh: RefreshConfig
  helperText: HelperText
}
