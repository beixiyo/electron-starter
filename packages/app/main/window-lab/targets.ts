import type { WindowLabTargetId } from '@ipc/services/window-lab/contract'
import type { WindowBounds, WindowConfig } from '@shared'
import { PHYSICAL_WINDOW_CONFIGS, WindowType } from '@shared'

/** Window Lab 原生预览 target 注册表；每个 target 只声明窗口配置和缩放锚点。 */
const WINDOW_LAB_NATIVE_TARGETS = {
  'voice-ime': {
    id: 'voice-ime',
    title: 'Window Lab Preview',
    windowConfig: PHYSICAL_WINDOW_CONFIGS[WindowType.VOICE_IME],
    resolveBounds: ({ current, workArea, width, height }: WindowLabResizeContext): WindowBounds => ({
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: current.y + current.height - height,
      width,
      height,
    }),
  },
} satisfies Record<WindowLabTargetId, WindowLabNativeTarget>

/** 读取 target；联合类型新增成员时由 Record 强制补齐配置。 */
export function getWindowLabNativeTarget(target: WindowLabTargetId): WindowLabNativeTarget {
  return WINDOW_LAB_NATIVE_TARGETS[target]
}

export type WindowLabNativeTarget = {
  id: WindowLabTargetId
  title: string
  windowConfig: WindowConfig
  resolveBounds: (context: WindowLabResizeContext) => WindowBounds
}

export type WindowLabResizeContext = {
  current: WindowBounds
  workArea: WindowBounds
  width: number
  height: number
}
