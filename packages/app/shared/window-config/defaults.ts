/**
 * 窗口配置的默认值归一化：把「没写」翻译成一个确定的值
 *
 * 同一份缺省逻辑会被创建路径与展示 / 收敛路径分别读到，散在各处就会不同源，
 * 所以统一收在这里，调用方只管调函数、不再各自写 `?? 默认值`
 */

import { EMPTY_INSETS, SHADOW_WINDOW_INSETS } from './metrics'
import type { AlwaysOnTopLevel, WindowConfig, WindowInsets } from './types'

const DEFAULT_ALWAYS_ON_TOP_LEVEL: AlwaysOnTopLevel = 'floating'

/**
 * 归一化窗口配置声明的可见内容留白
 *
 * 缺省档按窗口形态推导，而不是逐窗抄一遍：`transparent` + 无边框 + `hasShadow: false`
 * 的窗口一定是自绘 CSS 投影的，投影画不出窗口边界，四周必然有一圈 {@link SHADOW_WINDOW_INSETS}
 * 的透明带。交给系统画投影（`hasShadow: true`，如原生毛玻璃窗）或带边框的窗口则内容即窗口，
 * 留白为 0。留白与这条推导不同的窗口在自己的配置里显式声明覆盖
 */
export function resolveVisibleContentInsets(config: WindowConfig): WindowInsets {
  if (config.visibleContentInsets) {
    return { ...EMPTY_INSETS, ...config.visibleContentInsets }
  }

  const drawsOwnShadow = (config.transparent ?? false)
    && !(config.frame ?? true)
    && !(config.hasShadow ?? true)

  return drawsOwnShadow
    ? { ...SHADOW_WINDOW_INSETS }
    : { ...EMPTY_INSETS }
}

/** 归一化窗口的置顶层级，创建路径与展示路径读同一个结果 */
export function resolveAlwaysOnTopLevel(config: WindowConfig): AlwaysOnTopLevel {
  return config.alwaysOnTopLevel ?? DEFAULT_ALWAYS_ON_TOP_LEVEL
}

/**
 * 窗口的 frame 是否有理由越过屏幕可用区边缘
 *
 * 三个条件缺一不可：
 * - 无边框（`frame: false`）：解除系统边界收敛的开关只对无边框窗放行落点，
 *   带边框的窗口即便打开它，也只放宽尺寸、落点照旧被夹回可用区
 *   带边框窗口在此返回 false，是为了不留下一个静默无效的开关
 * - 声明了非零的可见内容留白：那圈留白纯透明，贴边时本来就该探出去，不该被当成越界
 * - 位置完全由预设决定（`movable: false`）：可拖动的窗口位置来自用户，系统那道
 *   边界收敛是它唯一的兜底；解除之后拖拽就能把可见内容拖出屏幕，而渲染层的
 *   手写拖动并不自己夹边
 */
export function allowsFrameOutsideWorkArea(config: WindowConfig): boolean {
  if (config.frame ?? true) return false
  if (config.movable ?? true) return false

  const insets = resolveVisibleContentInsets(config)
  return insets.top > 0 || insets.right > 0 || insets.bottom > 0 || insets.left > 0
}
