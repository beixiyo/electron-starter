export type SelectionData = {
  text: string
  programName?: string
  method?: string
  /** 选择开始时的鼠标位置 */
  mousePosStart?: { x: number, y: number }
  /** 选择结束时的鼠标位置 */
  mousePosEnd?: { x: number, y: number }
}

export const SELECTION_RENDERER_CHANNEL = {
  DATA: 'selection:data',
} as const

export type SelectionRendererChannel = typeof SELECTION_RENDERER_CHANNEL[keyof typeof SELECTION_RENDERER_CHANNEL]
