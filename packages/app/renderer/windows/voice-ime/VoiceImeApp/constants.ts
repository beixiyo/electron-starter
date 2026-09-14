/** 语音浮层各状态的尺寸、圆角与壳的形变参数。 */
import { VOICE_IME_CAPSULE_HEIGHT, VOICE_IME_SHADOW_INSET, VOICE_IME_SIZE } from '@shared'

export { VOICE_IME_SHADOW_INSET }
export const VOICE_UNDO_WINDOW_MS = 5000

export const VOICE_IME_CONTENT_SIZE = {
  /** 提示是固定宽度，其余胶囊形态会在挂载后按内容测宽。 */
  prompt: { width: 320, height: 52 },
  /**
   * 录音胶囊的宽度只是测量前那一帧的兜底：取「话筒 + Listening + 左右各 28」的实测近似
   *
   * 兜底与实测差得越少，起手那一帧越不跳——壳挂载时就按兜底画，量完再弹到实测值，
   * 而浮层是隐藏着挂载的，这一下会攒到下次 Fn 展示时才放：之前写 200 与实测 138 差 62px，
   * 用户看到的就是胶囊一出现先缩一截
   */
  recording: { width: 140, height: VOICE_IME_CAPSULE_HEIGHT },
  canceled: { width: 200, height: VOICE_IME_CAPSULE_HEIGHT },
  failure: { width: 200, height: VOICE_IME_CAPSULE_HEIGHT },
  /**
   * 结果卡撑满整个窗口：窗口就是按它定的固定尺寸（理由见 shared 的 `VOICE_IME_SIZE`），
   * 其余形态都比它小，各自的「窗口尺寸」只是壳要长到的目标
   */
  result: {
    width: VOICE_IME_SIZE.width - VOICE_IME_SHADOW_INSET * 2,
    height: VOICE_IME_SIZE.height - VOICE_IME_SHADOW_INSET * 2,
  },
} as const

export type VoiceImeViewMode = keyof typeof VOICE_IME_CONTENT_SIZE

/** 各形态壳的目标尺寸，含四边留白；窗口本身固定为 `VOICE_IME_SIZE`，这里只是壳要长到的值 */
export const VOICE_IME_WINDOW_SIZE = Object.fromEntries(
  Object.entries(VOICE_IME_CONTENT_SIZE).map(([mode, size]) => [mode, {
    width: size.width + VOICE_IME_SHADOW_INSET * 2,
    height: size.height + VOICE_IME_SHADOW_INSET * 2,
  }]),
) as { [K in VoiceImeViewMode]: { width: number; height: number } }

/**
 * 形态对应的可见圆角；命中区和视觉外壳共用这组值
 *
 * 除结果卡外都是正圆头胶囊（设计稿「语音输入法」组件一族：录音 / 提示 / 撤销 / 失败），
 * 999 交给 {@link getVoiceImeShellRadius} 换算成半高
 */
export const VOICE_IME_RADIUS: Record<VoiceImeViewMode, number> = {
  prompt: 999,
  recording: 999,
  canceled: 999,
  failure: 999,
  result: 24,
}

/**
 * 壳在某形态下实际画出来的圆角
 *
 * 胶囊那档写的是 999（正圆头），交给 motion 插值时不能直接用：9999px 插到 24px 前 99% 的
 * 时间都被夹在半高上，最后一帧才跳到 24。按内容高的一半给，胶囊态仍是正圆头，
 * 且与高度同一条弹簧，插值全程都是自洽的圆角矩形
 */
export function getVoiceImeShellRadius(mode: VoiceImeViewMode, contentHeight: number): number {
  const radius = VOICE_IME_RADIUS[mode]
  return radius >= 999
    ? contentHeight / 2
    : radius
}

export const VOICE_IME_HUGGING_VIEWS: readonly VoiceImeViewMode[] = [
  'recording',
  'canceled',
  'failure',
]

/** 图标的标称尺寸；lucide 的字形撑到 viewBox 的 75%，按 18 画才与 20 的设计资产等重 */
export const CAPSULE_ICON_CLASS = 'size-4.5'

/**
 * 胶囊内圆形按钮的框尺寸：图标 20 + 两侧内边距 6
 *
 * 圆底常驻之后，图标自带的留白不够看，6px 是设计稿实测值（20 的图标落在 32 的按钮内）
 */
export const CAPSULE_ACTION_SIZE = 32

/**
 * 端内元素在胶囊圆头里居中：内边距 = （胶囊高 − 元素尺寸）/ 2
 *
 * 圆头是正圆，只有上下留白与左右留白相等时才看着「嵌」在里面
 */
export const CAPSULE_ACTION_INSET = (VOICE_IME_CAPSULE_HEIGHT - CAPSULE_ACTION_SIZE) / 2

/** 相邻两颗按钮的间距，设计稿 `gap-[8px]`；眼睛读的是圆底之间的距离 */
export const CAPSULE_ACTION_GAP = 8

/** 带按钮的胶囊（撤销 / 失败 / 嵌入态录音）文案侧的内边距，设计稿 `pl-[16px]`，文案左对齐 */
export const CAPSULE_TEXT_INSET = 16

/** 文案与按钮组之间的最小间隙，设计稿 `gap-[8px]` */
export const CAPSULE_TEXT_GAP = 8

/** 纯文案胶囊（录音 / 提示）的左右内边距，设计稿 `px-[28px]` */
export const CAPSULE_PADDING_X = 28

/**
 * 胶囊内圆形按钮的共同样式
 *
 * 录音条的取消 / 完成、撤销条的撤销 / 关闭、失败条的重试 / 关闭是同一层级的操作，
 * 必须同尺寸同色；`text2` 本身是纯黑，alpha 必须显式写 `/70` 才是设计稿的 Text/2
 */
const CAPSULE_ACTION_BUTTON_BASE = 'flex shrink-0 items-center justify-center rounded-full text-text2/70 transition-colors'

/** 次要操作（撤销 / 重试 / 取消）：平时不占底色，hover 才浮出一层 */
export const CAPSULE_ACTION_BUTTON_CLASS = `${CAPSULE_ACTION_BUTTON_BASE} hover:bg-background3`

/** 主操作（关闭 / 完成）：常驻 Bg/3 底色，hover 加深到 Bg/4 */
export const CAPSULE_ACTION_BUTTON_FILLED_CLASS = `${CAPSULE_ACTION_BUTTON_BASE} bg-background3 hover:bg-background4`

export const CAPSULE_ACTION_STYLE = { width: CAPSULE_ACTION_SIZE, height: CAPSULE_ACTION_SIZE } as const

/** 状态文案，设计稿 14px / Medium */
export const CAPSULE_STATUS_TEXT_CLASS = 'whitespace-nowrap text-sm font-medium'

/** 倒计时，设计稿 14px / Regular，比状态文案深一档 */
export const CAPSULE_COUNTDOWN_CLASS = 'whitespace-nowrap text-sm font-normal tabular-nums text-text2/70'

/** 转写中文案的呼吸周期，单端时长；设计稿「0 ↔ 100% 交叉变化，单程一秒」 */
export const TRANSCRIBING_PULSE_SEC = 1

/**
 * 壳的两个外观端点，按主题 token 写成类而不是具体色值：模板要支持深色主题，
 * motion 插不了 `rgb(var(--x))`，底色与投影的过渡交给 CSS `transition`，尺寸与圆角仍走弹簧
 *
 * 胶囊：白底、设计稿投影 + 1px 内描边（描边用 inset 阴影不占布局，贴底元素才能压到真边）
 * 结果卡：Bg/3 底、设计稿「卡片投影」`0 8px 32px`
 */
export const VOICE_IME_SHELL_SURFACE_CLASS = {
  capsule: 'bg-background shadow-[0_5px_20px_rgba(0,0,0,0.1),inset_0_0_0_1px_rgba(0,0,0,0.1)]',
  card: 'bg-background3 shadow-[0_8px_32px_rgba(0,0,0,0.15)]',
} as const

/**
 * 壳的形变弹簧，形态之间、以及胶囊按内容换宽时共用
 *
 * 浮层与嵌入态宿主必须同一条：同一段话在两处长成同一张卡，手感不能一个脆一个绵
 */
export const VOICE_IME_SHELL_SPRING = { type: 'spring', stiffness: 400, damping: 35 } as const
