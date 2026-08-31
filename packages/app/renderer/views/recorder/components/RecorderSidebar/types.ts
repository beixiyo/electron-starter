import type { ReactNode } from 'react'
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
  /** 音源多选条（原生 tap 录音模式下渲染在音频设置卡顶部，混入系统音频） */
  audioSourceBar?: ReactNode
  /** Native 录音实验设置与当前处理状态。 */
  audioLabPanel?: ReactNode
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
