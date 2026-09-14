import type { IpcContract } from '@ipc/core/contract'
import type { WindowBounds } from '@shared'

/** Window Lab 的 IPC 命名空间。该工具只在开发环境使用。 */
export const WINDOW_LAB_NAMESPACE = 'window-lab'

const MAX_WINDOW_LAB_TEXT_LENGTH = 4000
const MAX_WINDOW_LAB_LABEL_LENGTH = 1000
const MAX_WINDOW_LAB_REMAINING_SECONDS = 180

/** 开发工具可展示的场景状态。它描述视觉状态，不启动真实业务流程。 */
export type WindowLabScene =
  | {
    kind: 'recording'
    state: 'listening' | 'transcribing'
    remainingSeconds: number | null
  }
  | { kind: 'prompt' }
  | { kind: 'canceled' }
  | { kind: 'failure'; message: string; detail?: string }
  | { kind: 'result'; text: string; sourceHost?: string }

/** 传给控制台和独立预览窗口的可序列化状态。 */
export type WindowLabPreview = {
  target: 'voice-ime'
  theme: 'light' | 'dark'
  scene: WindowLabScene
}

/** 预览窗口 target 的稳定标识。 */
export type WindowLabTargetId = WindowLabPreview['target']

/** 主进程窗口操作结果。失败通过 success/error 返回，避免 IPC handler 静默失败。 */
export type WindowLabOperationResult = {
  success: boolean
  error?: string
  bounds?: WindowBounds
}

/** Window Lab 的跨进程方法与事件契约。 */
export type WindowLabContract = IpcContract<{
  mainHandle: {
    /** 打开或聚焦开发控制台。 */
    openControl: () => WindowLabOperationResult
    /** 由控制台选择并打开独立的原生预览窗口。 */
    openPreview: (preview: WindowLabPreview) => WindowLabOperationResult
    /** 由控制台关闭原生预览窗口。 */
    closePreview: () => WindowLabOperationResult
    /** 读取控制台当前的预览状态。 */
    getPreview: () => WindowLabPreview | null
    /** 调整调用方自己的原生预览窗口。 */
    resizeSelf: (width: number, height: number, animate?: boolean) => WindowLabOperationResult
    /** 读取调用方自己的原生预览窗口边界。 */
    getSelfBounds: () => WindowLabOperationResult
  }
  rendererOn: {
    /** 预览窗口加载完成或当前场景发生改变时推送。 */
    previewChanged: WindowLabPreview | null
    /** 预览窗口移动、缩放、关闭或销毁时推送给控制台。 */
    boundsChanged: WindowBounds | null
  }
}>

/** 校验 IPC/URL 边界上的 Window Lab 预览数据。 */
export function isWindowLabPreview(value: unknown): value is WindowLabPreview {
  if (!isRecord(value)) return false
  return value.target === 'voice-ime'
    && (value.theme === 'light' || value.theme === 'dark')
    && isWindowLabScene(value.scene)
}

function isWindowLabScene(value: unknown): value is WindowLabScene {
  if (!isRecord(value) || typeof value.kind !== 'string') return false

  switch (value.kind) {
    case 'recording':
      return (value.state === 'listening' || value.state === 'transcribing')
        && isNullableFiniteNonNegativeNumber(value.remainingSeconds)
    case 'prompt':
    case 'canceled':
      return true
    case 'failure':
      return isStringWithinLimit(value.message, MAX_WINDOW_LAB_LABEL_LENGTH)
        && value.message.trim().length > 0
        && (value.detail === undefined || isStringWithinLimit(value.detail, MAX_WINDOW_LAB_LABEL_LENGTH))
    case 'result':
      return isStringWithinLimit(value.text, MAX_WINDOW_LAB_TEXT_LENGTH)
        && (value.sourceHost === undefined || isStringWithinLimit(value.sourceHost, MAX_WINDOW_LAB_LABEL_LENGTH))
    default:
      return false
  }
}

function isNullableFiniteNonNegativeNumber(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_WINDOW_LAB_REMAINING_SECONDS)
}

function isStringWithinLimit(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
