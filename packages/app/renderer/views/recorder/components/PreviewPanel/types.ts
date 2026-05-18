import type { MutableRefObject } from 'react'

/**
 * 录制结果概览
 */
export type PreviewSummary = {
  /**
   * 是否显示概览信息
   * @default false
   */
  visible: boolean
  /**
   * 类型标签文案
   */
  typeLabel: string
  /**
   * 类型值
   */
  typeValue?: string
  /**
   * 大小标签文案
   */
  sizeLabel: string
  /**
   * 大小值
   */
  sizeValue?: string
}

/**
 * 音频预览配置
 */
export type AudioPreviewConfig = {
  /**
   * 是否处于实时预览
   */
  isLive: boolean
  /**
   * 是否已有录制结果
   */
  hasResult: boolean
  /**
   * 空状态文案
   */
  emptyText: string
  /**
   * 实时预览标题
   */
  liveTitle: string
  /**
   * 实时预览描述
   */
  liveDescription: string
  /**
   * 实时 Badge 文案
   */
  liveBadgeText: string
  /**
   * 录制完成后的音频地址
   */
  recordedSrc?: string
  /**
   * 音频元素引用
   */
  ref: MutableRefObject<HTMLAudioElement | null>
}

/**
 * 视频预览配置
 */
export type VideoPreviewConfig = {
  /**
   * 是否处于实时预览
   */
  isLive: boolean
  /**
   * 是否已有录制结果
   */
  hasResult: boolean
  /**
   * 空状态文案
   */
  emptyText: string
  /**
   * 实时 Badge 文案
   */
  liveBadgeText: string
  /**
   * 录制完成的视频地址
   */
  recordedSrc?: string
  /**
   * 视频元素引用
   */
  ref: MutableRefObject<HTMLVideoElement | null>
}

/**
 * 预览面板 Props
 */
export type PreviewPanelProps = {
  title: string
  summary?: PreviewSummary
  audioPreview?: AudioPreviewConfig
  videoPreview?: VideoPreviewConfig
}
