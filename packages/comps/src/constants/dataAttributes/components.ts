/** 组件专用、仅用于组件内部 DOM 定位的 `data-*` 属性名 */
export const COMPONENT_DATA_ATTR = {
  slider: {
    /** 滑块手柄及其下标，轨道点击据此判断是否落在手柄上 */
    handle: 'data-vv-slider-handle',
  },
} as const
