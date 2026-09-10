/**
 * 浮层角标的形状几何
 *
 * 角标是从浮层边缘「长出来」的一块材料，轮廓由三段构成：
 * 1. 根部圆角：与浮层边缘相切，把边缘和斜边之间的折角填成平滑过渡
 * 2. 45° 斜边：决定角标的胖瘦，固定角度以对齐设计稿
 * 3. 尖端圆角：把两条斜边交出的直角磨圆
 *
 * 两处圆角都会在轴向上吃掉一段，可见高度因此低于半宽；
 * 定位需要的凸出量必须走这里计算，不能再按「半宽」估算
 */

/** 箭头默认宽度，单位 px；宽度按「根部与浮层边缘相切的两点」计量 */
export const DEFAULT_FLOATING_ARROW_SIZE = 22

/** 根部圆角半径占箭头宽度的比例，取自设计稿 */
const BASE_RADIUS_RATIO = 0.238
/** 尖端圆角半径占箭头宽度的比例，取自设计稿 */
const TIP_RADIUS_RATIO = 0.193

/** 两条 45° 斜边交出的直角被半径 r 的圆弧磨圆后，轴向缩短 r * (√2 - 1) */
const CORNER_SHRINK = Math.SQRT2 - 1

/**
 * 解析角标的实际尺寸与绘制路径
 *
 * 局部坐标以浮层边缘为 y = 0、尖端朝 y 正方向，宽度铺满 `[0, size]`；
 * 半径超出可用空间时按几何上限收敛，半径为 0 时退化为纯三角形
 */
export function resolveFloatingArrowGeometry(
  options: FloatingArrowGeometryOptions = {},
): FloatingArrowGeometry {
  const {
    size = DEFAULT_FLOATING_ARROW_SIZE,
    tipRadius,
    baseRadius,
  } = options

  const width = Math.max(size, 0)
  const halfWidth = width / 2

  /** 根部圆角向外补出的材料不超过半宽，否则两侧圆弧会互相穿插 */
  const base = clamp(baseRadius ?? width * BASE_RADIUS_RATIO, halfWidth)
  /** 两条斜边的交点高度，即未磨圆时的尖角高度；45° 斜边下等于剩余半宽 */
  const apexHeight = halfWidth - base * CORNER_SHRINK
  /** 尖端圆心不能越过浮层边缘，半径上限为 apexHeight / √2 */
  const tip = clamp(tipRadius ?? width * TIP_RADIUS_RATIO, apexHeight / Math.SQRT2)

  /** 圆弧与斜边的切点：圆心沿斜边法线回退一个半径，45° 下两轴各退 r / √2 */
  const baseTangentX = base / Math.SQRT2
  const baseTangentY = base - baseTangentX
  const tipTangentX = halfWidth - tip / Math.SQRT2
  const tipTangentY = apexHeight - tip / Math.SQRT2

  const path = [
    'M0,0',
    `A${round(base)},${round(base)} 0 0 1 ${round(baseTangentX)},${round(baseTangentY)}`,
    `L${round(tipTangentX)},${round(tipTangentY)}`,
    `A${round(tip)},${round(tip)} 0 0 0 ${round(width - tipTangentX)},${round(tipTangentY)}`,
    `L${round(width - baseTangentX)},${round(baseTangentY)}`,
    `A${round(base)},${round(base)} 0 0 1 ${round(width)},0`,
    'Z',
  ].join(' ')

  return {
    width,
    height: apexHeight - tip * CORNER_SHRINK,
    tipRadius: tip,
    baseRadius: base,
    path,
  }
}

/** 收敛到 [0, max]，并把 NaN 之类的脏输入按 0 处理 */
function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(Math.max(value, 0), Math.max(max, 0))
}

/** 路径坐标保留 3 位小数，避免浮点尾数把 d 属性撑长 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export type FloatingArrowGeometryOptions = {
  /**
   * 箭头宽度，单位 px
   * @default 22
   */
  size?: number
  /**
   * 尖端圆角半径，单位 px
   * @default size * 0.193
   */
  tipRadius?: number
  /**
   * 根部与浮层边缘衔接处的圆角半径，单位 px
   * @default size * 0.238
   */
  baseRadius?: number
}

export type FloatingArrowGeometry = {
  /** 箭头宽度，单位 px */
  width: number
  /** 箭头从浮层边缘凸出的可见高度，单位 px */
  height: number
  /** 收敛后的尖端圆角半径，单位 px */
  tipRadius: number
  /** 收敛后的根部圆角半径，单位 px */
  baseRadius: number
  /** SVG path 的 d 属性，坐标系为 `0 0 size size` */
  path: string
}
