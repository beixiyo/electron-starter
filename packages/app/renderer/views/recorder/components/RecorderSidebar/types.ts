import type { StateMeta } from '../../constants/state-meta'
import type { PrimaryAction } from '../../types'

type SidebarActionConfig = {
  stopLabel: string
  cancelLabel: string
  resetLabel: string
  downloadLabel: string
  isBusy: boolean
  hasResult: boolean
  onStop: () => void | Promise<void>
  onCancel: () => void | Promise<void>
  onReset: () => void
  onDownload: () => void | Promise<void>
}

type AudioCard = {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void | Promise<void>
}

/**
 * 录制侧边栏 Props
 */
export type RecorderSidebarProps = {
  stateMeta: StateMeta
  primaryAction: PrimaryAction
  actions: SidebarActionConfig
  audioCards: {
    title: string
    items: AudioCard[]
  }
  errorMessage: string | null
  /**
   * 录制时长（秒）
   */
  recordingDuration: number
  /**
   * 是否正在录制
   */
  isRecording: boolean
  /**
   * 是否暂停
   */
  isPaused: boolean
}
