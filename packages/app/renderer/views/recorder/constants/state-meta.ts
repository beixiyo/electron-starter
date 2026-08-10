import type { RecorderState } from '@jl-org/tool'
import type { TFunction } from 'i18next'

export type StateMeta = {
  /**
   * 状态标题
   */
  label: string
  /**
   * Tailwind 文本强调色
   */
  accent: string
}

/**
 * 根据当前语言构建录制状态文案
 */
export function buildRecorderStateMeta(t: TFunction<'app'>): Record<RecorderState | 'starting', StateMeta> {
  return {
    idle: {
      label: t('recorderState.idle.label'),
      accent: 'text-textPrimary',
    },
    starting: {
      label: t('recorderState.starting.label'),
      accent: 'text-info',
    },
    recording: {
      label: t('recorderState.recording.label'),
      accent: 'text-danger',
    },
    paused: {
      label: t('recorderState.paused.label'),
      accent: 'text-warning',
    },
    stopped: {
      label: t('recorderState.stopped.label'),
      accent: 'text-success',
    },
    error: {
      label: t('recorderState.error.label'),
      accent: 'text-danger',
    },
  }
}
