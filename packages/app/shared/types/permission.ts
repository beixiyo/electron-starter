import type { MediaAccessStatus } from './media'

/**
 * 统一权限类型
 * - microphone / camera / screen 走 systemPreferences 媒体权限
 * - accessibility 走 systemPreferences.isTrustedAccessibilityClient（Fn 长按 / 划词等）
 * - system-audio 走「仅系统音频录制」私有 TCC（Core Audio tap 手动录音混入系统音频，macOS 14.2+）
 */
export type PermissionKind = 'microphone' | 'camera' | 'screen' | 'accessibility' | 'system-audio'

/**
 * 统一权限状态，与媒体权限状态保持一致
 * - accessibility 只会返回 'granted' | 'denied'（macOS 无 not-determined 概念）
 */
export type PermissionStatus = MediaAccessStatus

/**
 * 支持「把 App 拖进列表」的权限面板
 *
 * macOS 的隐私面板分两类：这一类要求应用先出现在列表里，用户可以手动把 `.app` 拖进去；
 * 麦克风 / 摄像头则是「请求式」——App 没调过对应框架 API 就根本不在列表中，
 * 没有可拖的落点，只能走 `AVCaptureDevice.requestAccess` 那条系统弹窗路径
 */
export type PermissionDragKind = Extract<PermissionKind, 'accessibility' | 'screen'>

export const PERMISSION_DRAG_KINDS: readonly PermissionDragKind[] = ['accessibility', 'screen']

export function isPermissionDragKind(kind: PermissionKind): kind is PermissionDragKind {
  return (PERMISSION_DRAG_KINDS as readonly PermissionKind[]).includes(kind)
}

/** 引导卡片的渲染数据；主进程单向推给卡片窗口 */
export type PermissionDragGuidePayload = {
  kind: PermissionDragKind
  /** 拖拽提示里出现的应用名 */
  appName: string
  /** 应用图标 data URL；取不到时为 null，卡片改用占位块 */
  iconDataUrl: string | null
  /**
   * 是否真的能发起拖拽
   *
   * 解析不到 `.app` bundle 时为 false，卡片把拖拽区换成「在 Finder 中显示」，
   * 而不是留一个拖不动的图标
   */
  draggable: boolean
  /**
   * 卡片当前阶段
   *
   * - `waiting`：等待用户拖拽
   * - `granted`：已探测到授权，显示完成态后自动关闭
   * - `unconfirmed`：用户已拖过，但在限定时间内没等到授权信号
   *
   * `unconfirmed` 是必要的第三态，不能并进 `waiting`：拖放成功但系统里那条 TCC 记录
   * 绑的是旧证书时，系统设置显示「已开启」而 `AXIsProcessTrusted()` 仍为 false，
   * 此时卡片若停在 waiting 会一直挂在屏幕上，用户明明已经做完了动作
   */
  phase: PermissionDragGuidePhase
  /**
   * 窗口底下的 vibrancy 材质当前是否按深色渲染
   *
   * 材质跟随 NSApp 外观，也就是主进程的 `nativeTheme`；而 Tailwind 的 `dark:`
   * 是按 `.dark` class 生效的（`@config` 里 darkMode: 'class'），渲染层自己判断不了
   * 材质是什么色，必须由主进程告知后再给 html 加 class，文字才能与材质同深浅
   */
  systemDark: boolean
}

export type PermissionDragGuidePhase = 'waiting' | 'granted' | 'unconfirmed'
