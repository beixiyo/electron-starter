import { BOTTOM_FLOATING_CLEARANCE } from '@shared'

export const DEFAULT_WINDOW_SIZE = {
  width: 1280,
  height: 1080,
}

export const WINDOW_POSITION_MARGINS = {
  standard: 20,
  topCenter: 50,
  /**
   * `bottom-center` 服务的全是底部透明浮层
   *
   * 本档与其它档一样量的是**可见内容**距工作区边缘多远：窗口四周那圈透明阴影留白
   * 由各窗自己的 `visibleContentInsets` 在 `calculateWindowPosition` 里让回去，
   * 预设里不再替某一个窗口硬扣一份 inset
   *
   * 另一种写法是在预设里直接替某个窗口减掉一个 inset（净空 8 − 阴影留白 30 = −22），
   * 靠「窗口比预设再往下探 22px」凑出可见内容离底 8px。落点本身是对的，但窗口若没有
   * 声明留白，边界收敛只认窗口边，这 22px 就会被判成越界，第一次 `resizeTo` 便把窗口
   * 拽回工作区内，可见内容离底反而变成一个完整的 inset。让预设与收敛读同一份 inset，
   * 中途才不会被拉回
   */
  bottomCenter: BOTTOM_FLOATING_CLEARANCE,
} as const
