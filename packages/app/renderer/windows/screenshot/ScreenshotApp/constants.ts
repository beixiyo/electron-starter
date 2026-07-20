/**
 * 选区最小有效尺寸（CSS 像素）
 *
 * 双重用途：拉新选区时小于此值视作误触并丢弃；缩放时作为对边间距下限，
 * 防止把选区拖成零宽高后再也抓不住把手
 */
export const MIN_SELECTION_SIZE = 5

/** 把手视觉边长（CSS 像素） */
export const HANDLE_SIZE = 8

/**
 * 把手命中判定半径（CSS 像素）
 *
 * 刻意大于视觉半径，指针无需精确压在把手上也能抓住
 */
export const HANDLE_HIT_RADIUS = 8

/** 方向键微调步长（CSS 像素） */
export const NUDGE_STEP = 1

/** 按住 Shift 时的方向键步长，用于快速粗调 */
export const NUDGE_STEP_FAST = 10

/** 工具栏与选区的间距，同时用作贴边时与视口边缘的最小留白 */
export const TOOLBAR_GAP = 8
