/** 浮层形态、内容测量与透明窗口命中区的统一编排；窗口本身尺寸固定，形变全在渲染层。 */
import type { VoiceImeShellMetricsPatch } from '@shared'
import { VOICE_IME_SHADOW_INSET, VOICE_IME_SIZE, WindowType } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import { getElementWindowHitTestRegion, useRoundedWindowHitTest } from '../../../shared'
import { VOICE_IME_HUGGING_VIEWS, VOICE_IME_RADIUS, VOICE_IME_WINDOW_SIZE } from '../constants'
import type { VoiceImeViewMode } from '../constants'

const productionRuntime: VoiceImeViewportRuntime = {
  reportShell: (metrics) => {
    void $ipc.voiceIme.setShellMetrics(metrics)
  },
  hide: async () => {
    await $ipc.window.hide(WindowType.VOICE_IME)
  },
  /**
   * 窗口一隐藏页面就进入 `hidden`，无论是渲染层自己收的还是主进程收的
   * （投递完成、短按、延时收起……），所有收窗路径在这里汇成一个信号
   */
  onHidden: (listener) => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') listener()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  },
}

/**
 * 视图形态与壳尺寸的绑定：切视图即换壳的目标尺寸，圆角命中区跟着壳走
 *
 * 窗口**从不 resize**，尺寸固定为最大一档（shared 的 `VOICE_IME_SIZE`），所有形态的
 * 形变都由渲染层的壳（`VoiceImeShell`）在这同一个窗口里画：
 *
 * 实测症状：胶囊切结果卡时，胶囊先整体平移到结果卡的左上角，停一下再放大，
 * 看着像两段动画、中途大小还会闪。根因有两层：主进程 `setBounds(bounds, animate)`
 * 按自己的曲线挪窗口原点（窗口居中、底边钉死，长大时原点必然往左上跑），壳却锚在
 * 窗口左上角、按渲染层的弹簧长大，两条互不知情的曲线叠在一起；更底下一层是透明窗
 * `setBounds` 本身会先把上一帧按新原点画一次再换新帧（electron/electron#39834），
 * 可见期间只要变过尺寸这一帧就躲不掉，瞬切也躲不掉
 *
 * 所以窗口只在建出来时定一次尺寸，可见期间不动；壳锚在窗口底边正中，尺寸一变就从
 * 这个点向上、向两侧长，屏幕上只剩壳自己的一条弹簧。代价是主进程不能再拿窗口顶边
 * 当胶囊顶边——壳的度量由这里上报（{@link VoiceImeViewportRuntime.reportShell}）
 */
export function useVoiceImeViewport(options: UseVoiceImeViewportOptions = {}): VoiceImeViewport {
  const { initialViewMode = 'recording', runtime = productionRuntime } = options
  const [viewMode, setViewMode] = useState<VoiceImeViewMode>(initialViewMode)
  const [contentWidth, setContentWidth] = useState<number | null>(null)
  const [mountKey, setMountKey] = useState(0)
  const viewModeRef = useRef(initialViewMode)
  const fallbackWindowSize = VOICE_IME_WINDOW_SIZE[viewMode]
  const isHugging = VOICE_IME_HUGGING_VIEWS.includes(viewMode)

  const reportContentWidth = useLatestCallback((width: number, sourceViewMode?: VoiceImeViewMode) => {
    if (!Number.isFinite(width) || width <= 0) return
    if (sourceViewMode && sourceViewMode !== viewModeRef.current) return
    if (!VOICE_IME_HUGGING_VIEWS.includes(viewModeRef.current)) return
    setContentWidth((previous) =>
      previous === width
        ? previous
        : width
    )
  })

  const switchView = useLatestCallback((next: VoiceImeViewMode) => {
    viewModeRef.current = next
    setViewMode(next)
    /** 上一形态的测宽回调可能在 mode="wait" 退场期间再次触发，先清空并标记新形态。 */
    setContentWidth(null)
  })

  /** 壳要去的尺寸；{@link VOICE_IME_WINDOW_SIZE} 里的宽度只用来撑过测量前的那一帧 */
  const size = isHugging && contentWidth !== null
    ? {
      width: contentWidth + VOICE_IME_SHADOW_INSET * 2,
      height: fallbackWindowSize.height,
    }
    : fallbackWindowSize

  /**
   * 壳的目标尺寸一变就告诉主进程，全局提示条靠它贴在胶囊上方
   *
   * 报的是**目标**值而不是动画中的瞬时值：提示条与失败条常常同一拍出现，
   * 按目标算它一出来就在终点位置，不用跟着壳的弹簧再挪一次
   */
  useEffect(() => {
    runtime.reportShell({
      width: size.width - VOICE_IME_SHADOW_INSET * 2,
      height: size.height - VOICE_IME_SHADOW_INSET * 2,
    })
  }, [runtime, size.width, size.height])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (size.width <= VOICE_IME_SIZE.width && size.height <= VOICE_IME_SIZE.height) return

    console.warn(
      `[voice-ime] surface ${size.width}x${size.height} exceeds the fixed window ${VOICE_IME_SIZE.width}x${VOICE_IME_SIZE.height}; it will be clipped`,
    )
  }, [size.width, size.height])

  /**
   * 收窗后把形态树整棵重挂成初始形态，而不是切回去让它自己动画过去
   *
   * 实测症状：结果卡按 ✕ / Esc 关掉，下次 Fn 先弹出上一张结果卡，再缩成胶囊
   * 根因是隐藏窗口的渲染进程被 backgroundThrottling 冻住 rAF，motion 的弹簧与
   * `AnimatePresence` 的退场都停在隐藏那一帧，再展示时接着放；把复位写在隐藏之后也没用，
   * 动画一样要等展示才开始跑。只有让整棵树重新挂载——旧树连退场都不放就消失，
   * 新树 `initial={false}` 挂上就是初始形态——展示时才没有任何在飞的动画
   */
  const remountAsInitial = useLatestCallback(() => {
    viewModeRef.current = initialViewMode
    setViewMode(initialViewMode)
    setContentWidth(null)
    setMountKey((key) => key + 1)
  })

  useEffect(() => runtime.onHidden(remountAsInitial), [runtime, remountAsInitial])

  const hideAndReset = useLatestCallback(async () => {
    /**
     * 复位由 `onHidden` 统一驱动（主进程收窗也走它）；这里只在宿主收了却没进 `hidden`
     * 的环境下兜底，例如关掉 backgroundThrottling 或浏览器画布
     */
    await runtime.hide()
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') remountAsInitial()
  })

  return {
    viewMode,
    /** 壳要长到的尺寸（含透明阴影留白），直接交给 VoiceImeSurface。 */
    size,
    /** 兼容旧调用方：与 size 保持同一份引用。 */
    windowSize: size,
    shadowInset: VOICE_IME_SHADOW_INSET,
    mountKey,
    switchView,
    reportContentWidth,
    hideAndReset,
  }
}

/**
 * 生产 Voice IME 的透明区域点击穿透；Window Lab 不调用，避免 Web 预览触碰 IPC
 *
 * 命中区按壳元素的实际矩形算而不是按窗口内缩：窗口固定为最大一档，胶囊只占底部一小截，
 * 按窗口算会把胶囊上方一大片透明区也当成实体，挡住后面应用的点击
 */
export function useVoiceImeWindowHitTest(
  viewMode: VoiceImeViewMode,
  shellRef: React.RefObject<HTMLElement | null>,
): void {
  useRoundedWindowHitTest(WindowType.VOICE_IME, () => {
    const shell = shellRef.current
    if (!shell) return []

    return [getElementWindowHitTestRegion(shell, VOICE_IME_RADIUS[viewMode])]
  })
}

export type VoiceImeViewportRuntime = {
  /**
   * 上报壳的目标度量（不含留白），主进程据此摆全局提示条；浏览器画布可实现为空操作
   *
   * 没有 `resizeTo` 是有意的：窗口尺寸固定、可见期间不 resize，形变只由渲染层的壳画
   */
  reportShell: (metrics: VoiceImeShellMetricsPatch) => void
  /** 隐藏当前宿主；浏览器画布可实现为空操作。 */
  hide: () => void | Promise<void>
  /**
   * 订阅「宿主已隐藏」，返回取消订阅；形态树在这一刻整棵重挂成初始形态
   *
   * 浏览器画布返回空操作即可——切个标签页就把预览打回初始形态，只会碍事
   */
  onHidden: (listener: () => void) => () => void
}

export type UseVoiceImeViewportOptions = {
  /**
   * 初始形态，也是每次收窗后重挂回去的形态；浮层的静息态就是胶囊，展示第一帧不该有形变
   * @default 'recording'
   */
  initialViewMode?: VoiceImeViewMode
  runtime?: VoiceImeViewportRuntime
}

export type VoiceImeViewport = {
  viewMode: VoiceImeViewMode
  /** 壳要长到的尺寸，含透明阴影留白（即该形态的「窗口尺寸」）；内容自适应形态按实测宽度覆盖。 */
  size: { width: number; height: number }
  windowSize: { width: number; height: number }
  shadowInset: number
  /**
   * 形态树的挂载代次，宿主把它当 `key` 挂在 `VoiceImeSurface` 上
   *
   * 每次收窗 +1：整棵树从初始形态重新挂载，不留任何被隐藏冻住、展示时才接着放的动画
   */
  mountKey: number
  switchView: (next: VoiceImeViewMode) => void
  reportContentWidth: (width: number, sourceViewMode?: VoiceImeViewMode) => void
  hideAndReset: () => Promise<void>
}
