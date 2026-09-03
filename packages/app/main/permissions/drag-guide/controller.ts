/**
 * 权限拖拽引导：把「系统设置」旁边的卡片、拖拽源与授权轮询串成一次会话
 *
 * 交互本身不依赖任何系统 API——macOS 没有提供请求 TCC 授权 UI 的接口
 * 这里做的是：打开对应隐私面板、在它上面浮一张不抢焦点的卡片、
 * 由卡片发起一次**原生文件拖拽**把 `.app` 交给系统设置的列表
 * 用户松手即等于在 Finder 里把 App 拖进列表，系统据此写入 TCC 条目
 */

import { createMainDiagnosticLogger } from '@main/logging'
import { resolveBundledResource } from '@main/utils/bundled-resource'
import { windowManager } from '@main/window-manager'
import type { PermissionDragGuidePayload, PermissionDragGuidePhase, PermissionDragKind } from '@shared'
import { PERMISSION_DRAG_GUIDE_CONTENT_SIZE, PERMISSION_DRAG_GUIDE_SHADOW_INSET, WindowType } from '@shared'
import type { BrowserWindow } from 'electron'
import { app, nativeImage, nativeTheme, screen, shell, systemPreferences } from 'electron'
import { readFileSync } from 'node:fs'
import iconAsset from '../../../resources/icon.png?asset'
import { openPrivacySettings } from '../privacy-urls'
import { resolveAppBundlePath } from './app-bundle'
import type { Rect } from './placement'
import { computeDragGuideBounds } from './placement'
import { probeSettingsWindow, waitForStableSettingsWindow } from './settings-window-locator'

const log = createMainDiagnosticLogger('permission.drag-guide')

/** 等系统设置窗口出现并停稳的预算；冷启动 + 从 Dock 恢复的精灵动画都在这个量级 */
const SETTINGS_WAIT_BUDGET_MS = 2_500
/**
 * 跟随系统设置窗口移动的重定位间隔
 *
 * 是「上一次探测结束到下一次开始」的间隔，不是固定节拍：探测要 spawn 一个 helper 进程，
 * 超时上限（2s）大于间隔，用固定节拍会在系统繁忙时并发拉起多个 helper
 */
const TRACK_INTERVAL_MS = 700
/** 授权状态轮询间隔 */
const POLL_INTERVAL_MS = 700
/** 连续多少次探不到系统设置窗口就认定用户已关掉它 */
const SETTINGS_GONE_SAMPLES = 3
/** 会话总时长上限：用户长时间没动作就自行收摊，不在屏幕上留一张孤儿卡片 */
const SESSION_TIMEOUT_MS = 3 * 60 * 1000
/** 授权成功后卡片停留时间，让用户看见完成态 */
const GRANTED_LINGER_MS = 1_200
/**
 * 发起拖拽后等待授权信号的上限
 *
 * 超时不代表失败：TCC 里若已存在同 bundle id 的旧记录，拖入只会更新 auth_value，
 * csreq 仍绑在旧签名上——系统设置显示「已开启」而 `AXIsProcessTrusted()` 恒为 false
 * 用户已经做完动作，卡片必须给出交代并退场，不能默默挂到会话超时
 */
const DRAG_RESOLVE_TIMEOUT_MS = 12_000
/** 进入 `unconfirmed` 后卡片停留时间，够读完那句提示 */
const UNCONFIRMED_LINGER_MS = 4_000
/** 拖拽发起后加快轮询，让「拖完即消失」跟手 */
const POST_DRAG_POLL_INTERVAL_MS = 350

type GuideSession = {
  generation: number
  kind: PermissionDragKind
  window: BrowserWindow
  bundlePath: string | null
  /** 拖拽时跟着光标走的图像；一次会话只从磁盘读一次 */
  icon: Electron.NativeImage
  /** 卡片里展示的图标；取不到时为 null */
  iconDataUrl: string | null
  trackTimer: ReturnType<typeof setTimeout> | null
  pollTimer: ReturnType<typeof setInterval> | null
  timeoutTimer: ReturnType<typeof setTimeout> | null
  lingerTimer: ReturnType<typeof setTimeout> | null
  missingSettingsSamples: number
  /** 因系统设置弹出 sheet 而暂时藏起，sheet 收起后要放回来 */
  hiddenForSheet: boolean
  phase: PermissionDragGuidePhase
  dragResolveTimer: ReturnType<typeof setTimeout> | null
}

let session: GuideSession | null = null
let generationCounter = 0

/**
 * 启动一次拖拽引导
 *
 * 返回值要区分「没展示」的原因，调用方才知道该不该自己补开面板：
 * `already-granted` 时本函数**没有**打开任何面板（被拖的 bundle 已授权），
 * 而调用方可能因为别的原因仍需要用户进设置页（例如 accessibility 还差 fn-listener helper），
 * 这时必须由调用方自行 `openPrivacySettings`
 * `unavailable` 与 `superseded` 在 macOS 上面板**已经打开**，调用方不得再开：
 * 再开一次会重新激活系统设置，打断另一次正在等它停稳的会话
 */
export async function startPermissionDragGuide(
  kind: PermissionDragKind,
): Promise<DragGuideStartResult> {
  if (process.platform !== 'darwin') {
    return 'unavailable'
  }

  if (isTargetGranted(kind)) {
    log.info('start.skipped-granted', 'drag guide skipped because target is already granted', { kind })
    return 'already-granted'
  }

  stopPermissionDragGuide('restart')

  const generation = ++generationCounter
  openPrivacySettings(kind)

  /**
   * 先等窗口停稳再建卡片：系统设置冷启动 / 从 Dock 恢复期间窗口会连续换位置，
   * 用第一帧会把卡片贴到一个中间态坐标上，看起来像是飘在无关的位置
   */
  const settingsBounds = await waitForStableSettingsWindow(SETTINGS_WAIT_BUDGET_MS)
  if (generation !== generationCounter) {
    return 'superseded'
  }

  const window = windowManager.create(WindowType.PERMISSION_DRAG_GUIDE)
  if (!window) {
    log.warn('start.window-failed', 'failed to create drag guide window', { kind })
    return 'unavailable'
  }

  const bundlePath = resolveAppBundlePath(app.getPath('exe'))
  if (!bundlePath) {
    log.warn('start.no-bundle', 'no .app bundle resolved; drag will degrade to reveal in Finder', {
      executable: app.getPath('exe'),
    })
  }

  const icon = loadDragIcon()
  session = {
    generation,
    kind,
    window,
    bundlePath,
    icon,
    iconDataUrl: icon.isEmpty()
      ? null
      : icon.toDataURL(),
    trackTimer: null,
    pollTimer: null,
    timeoutTimer: null,
    lingerTimer: null,
    missingSettingsSamples: 0,
    hiddenForSheet: false,
    phase: 'waiting',
    dragResolveTimer: null,
  }

  applyBounds(window, settingsBounds)
  window.once('closed', () => {
    if (session?.generation === generation) {
      clearTimers(session)
      session = null
    }
  })

  /**
   * 走 windowManager.showInactive 而不是自己 `window.showInactive()`：
   * 它内部的 presentWhenLoaded 带 did-finish-load 兜底定时器，
   * 首屏事件被漏掉时窗口不会永远停在不可见状态
   *
   * 必须是 showInactive 而非 show：一旦抢走焦点，系统设置就不再是 key window，
   * 拖拽途中列表的放置高亮会消失，用户等于对着一个看起来不接受拖放的窗口在拖
   */
  windowManager.showInactive(WindowType.PERMISSION_DRAG_GUIDE)
  window.webContents.once('did-finish-load', () => {
    if (session?.generation === generation) {
      sendPayload(session)
    }
  })

  scheduleTrack(session)
  session.pollTimer = setInterval(() => pollGrant(generation), POLL_INTERVAL_MS)
  session.timeoutTimer = setTimeout(() => stopPermissionDragGuide('timeout'), SESSION_TIMEOUT_MS)

  log.info('start.presented', 'permission drag guide presented', {
    kind,
    docked: settingsBounds !== null,
    draggable: bundlePath !== null,
  })
  return 'presented'
}

/**
 * - `presented`：卡片已展示，面板也已打开
 * - `already-granted`：被拖的 bundle 本身已授权，本函数什么都没做
 * - `superseded`：等待窗口停稳期间被更新的一次调用取代；面板已打开，由那次调用接管
 * - `unavailable`：非 macOS（未开面板）或建窗失败（面板已打开）
 */
export type DragGuideStartResult = 'presented' | 'already-granted' | 'superseded' | 'unavailable'

/** 结束当前引导会话；无会话时是空操作 */
export function stopPermissionDragGuide(reason: StopReason): void {
  const current = session
  if (!current) return

  session = null
  clearTimers(current)
  windowManager.destroy(WindowType.PERMISSION_DRAG_GUIDE)
  log.info('stop', 'permission drag guide stopped', { kind: current.kind, reason })
}

/**
 * 由卡片发起原生文件拖拽
 *
 * `webContents.startDrag` 是把文件交给**别的进程**的唯一途径：它往 NSPasteboard 写
 * `kUTTypeFileURL`，系统设置才看得懂这次拖放。HTML5 的 dragstart 只在本进程内流转，
 * 系统设置对它一无所知
 *
 * 拖拽路径在这里解析，绝不采信卡片传来的值——卡片只能决定拖拽时显示的图像
 *
 * 只在 `waiting` 阶段受理：卡片虽然也会在完成态禁用拖拽区，但阶段推送到达之前
 * 的那次 mousedown 仍会打到这里，策略必须由主进程兜底，不能只靠渲染层
 */
export function startPermissionDragGuideDrag(event: unknown): boolean {
  const current = session
  if (!current || !isGuideSender(current, event) || current.phase !== 'waiting') {
    return false
  }

  if (!current.bundlePath) {
    shell.showItemInFolder(app.getPath('exe'))
    return false
  }

  try {
    current.window.webContents.startDrag({ file: current.bundlePath, icon: current.icon })
    log.info('drag.started', 'native app bundle drag started', {
      kind: current.kind,
      bundlePath: current.bundlePath,
    })
    armDragResolution(current)
    return true
  }
  catch (error) {
    log.warn('drag.failed', 'native app bundle drag failed', {
      kind: current.kind,
      error: String(error),
    })
    return false
  }
}

/**
 * 当前引导状态快照，供卡片挂载后补拉
 *
 * 窗口是懒建的：主进程推首帧 `dragGuideState` 时这个 renderer 可能还没订阅，
 * 那条推送会直接丢掉，表现为卡片一片空白。与 GlobalToast 同一个坑、同一套解法——
 * 渲染层先订阅再补拉，两者之间到达的推送也不会漏
 */
export function getPermissionDragGuideState(): PermissionDragGuidePayload | null {
  return session
    ? buildPayload(session)
    : null
}

/** 卡片上的关闭按钮 */
export function dismissPermissionDragGuide(event: unknown): void {
  const current = session
  if (!current || !isGuideSender(current, event)) {
    return
  }
  stopPermissionDragGuide('dismissed')
}

/**
 * 只读**被拖拽那个 bundle 自己**的授权状态，不读业务上的合成状态
 *
 * `getPermissionStatus('accessibility')` 还要求 fn-listener helper 同样被信任，
 * 拿它当完成信号的话，用户把 App 拖进列表、系统也确实授权了，卡片却永远不变绿
 */
function isTargetGranted(kind: PermissionDragKind): boolean {
  if (kind === 'accessibility') {
    return systemPreferences.isTrustedAccessibilityClient(false)
  }
  return systemPreferences.getMediaAccessStatus('screen') === 'granted'
}

/**
 * 拖拽已发起：提高轮询频率，并给一个「等不到授权也要退场」的兜底
 *
 * Electron 的 `startDrag` 没有落点回调，拿不到「用户到底松手在哪」，
 * 因此只能以发起拖拽为起点做有界等待，而不是无限期停在 waiting
 */
function armDragResolution(current: GuideSession): void {
  const { generation } = current

  if (current.pollTimer) clearInterval(current.pollTimer)
  current.pollTimer = setInterval(() => pollGrant(generation), POST_DRAG_POLL_INTERVAL_MS)

  if (current.dragResolveTimer) clearTimeout(current.dragResolveTimer)
  current.dragResolveTimer = setTimeout(() => {
    const active = session
    if (active?.generation !== generation || active.phase !== 'waiting') return

    active.phase = 'unconfirmed'
    sendPayload(active)
    log.info('drag.unresolved', 'drag completed but no grant observed in time', {
      kind: active.kind,
      timeoutMs: DRAG_RESOLVE_TIMEOUT_MS,
    })

    active.lingerTimer = setTimeout(() => {
      if (session?.generation === generation) {
        stopPermissionDragGuide('drag-unresolved')
      }
    }, UNCONFIRMED_LINGER_MS)
  }, DRAG_RESOLVE_TIMEOUT_MS)
}

function pollGrant(generation: number): void {
  const current = session
  if (current?.generation !== generation || current.phase === 'granted') return

  if (!isTargetGranted(current.kind)) return

  current.phase = 'granted'
  if (current.dragResolveTimer) clearTimeout(current.dragResolveTimer)
  if (current.lingerTimer) clearTimeout(current.lingerTimer)
  sendPayload(current)
  log.info('granted', 'permission granted while drag guide was open', { kind: current.kind })

  current.lingerTimer = setTimeout(() => {
    if (session?.generation === generation) {
      stopPermissionDragGuide('granted')
    }
  }, GRANTED_LINGER_MS)
}

/**
 * 排下一次跟随探测；上一次探测结束后才排，保证任一时刻至多一个 helper 在跑
 *
 * 会话被 `stopPermissionDragGuide` 收掉后 `session` 已换代或为 null，链条自然断开；
 * `clearTimers` 负责清掉已排但未触发的那一次
 */
function scheduleTrack(current: GuideSession): void {
  const { generation } = current

  current.trackTimer = setTimeout(() => {
    void trackSettingsWindow(generation).finally(() => {
      const active = session
      if (active?.generation === generation) {
        scheduleTrack(active)
      }
    })
  }, TRACK_INTERVAL_MS)
}

/**
 * 跟随系统设置窗口，并在它被关掉时收摊
 *
 * 要求连续 {@link SETTINGS_GONE_SAMPLES} 次探不到才判定关闭：单次探测会在
 * 授权 sheet 弹出、切换面板这些瞬间落空，一次就撤会把卡片在用户眼皮底下关掉
 * 系统设置被最小化或切到别的 Space 时 helper 同样探不到（只列在屏窗口），
 * 引导会随之收摊——卡片跨所有 Space 显示，留着只会浮在无关的桌面上
 */
async function trackSettingsWindow(generation: number): Promise<void> {
  if (session?.generation !== generation) return

  const probe = await probeSettingsWindow()
  const current = session
  if (current?.generation !== generation) return

  if (!probe) {
    current.missingSettingsSamples += 1
    if (current.missingSettingsSamples >= SETTINGS_GONE_SAMPLES) {
      stopPermissionDragGuide('settings-closed')
    }
    return
  }

  current.missingSettingsSamples = 0
  applyBounds(current.window, probe.bounds)
  syncSheetVisibility(current, probe.sheetPresented)
}

/**
 * 系统设置弹出确认 sheet（输入密码 / Touch ID）期间把卡片藏起来，收起后再放回
 *
 * 实测症状：拖入后系统要求管理员确认，用户却很难输入密码或验证指纹
 * 根因机制：确认框是系统设置自己挂在主窗口内的一个窗口，弹出后它排在最前面；
 * helper 之前取「最前面的窗口」当锚点，卡片会被贴到 sheet 的下半部分，正好盖住输入框
 * 方案边界：helper 已改为按面积取主窗口，这里再在 sheet 存在期间让位，
 * 只藏不销毁，会话、计时器与授权轮询照常进行；授权在 sheet 里完成后卡片会以完成态回来
 */
function syncSheetVisibility(current: GuideSession, sheetPresented: boolean): void {
  const { window } = current
  if (window.isDestroyed()) return

  if (sheetPresented && window.isVisible()) {
    current.hiddenForSheet = true
    window.hide()
    log.info('sheet.yield', 'drag guide hidden while System Settings shows a sheet', { kind: current.kind })
    return
  }

  if (!sheetPresented && current.hiddenForSheet) {
    current.hiddenForSheet = false
    window.showInactive()
    log.info('sheet.resume', 'drag guide restored after System Settings sheet closed', { kind: current.kind })
  }
}

function applyBounds(window: BrowserWindow, settingsBounds: Rect | null): void {
  if (window.isDestroyed()) return

  const anchor = settingsBounds ?? fallbackAnchor()
  const display = screen.getDisplayMatching(anchor)
  window.setBounds(
    computeDragGuideBounds(
      anchor,
      display.workArea,
      PERMISSION_DRAG_GUIDE_CONTENT_SIZE,
      PERMISSION_DRAG_GUIDE_SHADOW_INSET,
    ),
    false,
  )
}

/**
 * 探不到系统设置窗口时的兜底锚点
 *
 * 拿光标所在显示器的工作区当「假想的系统设置窗口」，卡片因此落在该屏偏下的位置
 * 贴合会不准，但拖拽本身照常可用——这比因为定位失败就不给引导要好
 */
function fallbackAnchor(): Rect {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return display.workArea
}

function sendPayload(current: GuideSession): void {
  if (current.window.isDestroyed()) return
  stateEmitter?.(buildPayload(current), current.window)
}

function buildPayload(current: GuideSession): PermissionDragGuidePayload {
  return {
    kind: current.kind,
    appName: app.getName(),
    iconDataUrl: current.iconDataUrl,
    draggable: current.bundlePath !== null,
    phase: current.phase,
    systemDark: isMaterialDark(),
  }
}

/**
 * 窗口底下的 vibrancy 材质此刻按哪种外观渲染
 *
 * 材质跟随 NSApp 的外观，而 NSApp 的外观正是 `nativeTheme` 在管，所以文字深浅
 * 必须以它为准。不能去读 NSUserDefaults 的 `AppleInterfaceStyle`：那是系统的真实外观，
 * 应用一旦锁定 themeSource，材质与系统外观就会分家，按系统外观配字会得到
 * 「浅色材质 + 白字」这种不可读的组合
 */
function isMaterialDark(): boolean {
  return nativeTheme.shouldUseDarkColors
}

/**
 * 由 IPC 层注入的状态推送函数
 *
 * 控制器不直接 import `permissionService`：那会构成
 * service → @main/permissions → drag-guide → service 的循环引用
 * 控制器只负责「什么时候该推、推什么」，「怎么推到渲染层」交给调用方决定
 */
let stateEmitter: DragGuideStateEmitter | null = null

/** 注册状态推送实现；由 `ipc/services/permission/service.ts` 在模块初始化时调用一次 */
export function setPermissionDragGuideStateEmitter(emitter: DragGuideStateEmitter): void {
  stateEmitter = emitter
}

export type DragGuideStateEmitter = (
  payload: PermissionDragGuidePayload,
  window: BrowserWindow,
) => void

/**
 * 只认引导卡片窗口自己发来的调用
 *
 * 这两个动作能发起一次 `.app` 的原生拖拽，不加校验的话应用内任何 renderer
 * 都能触发。event 的类型跟随 `ipc/core` 的既有惯例做结构化读取
 */
function isGuideSender(current: GuideSession, event: unknown): boolean {
  const senderId = (event as { sender?: { id?: number } } | undefined)?.sender?.id
  return !current.window.isDestroyed()
    && senderId === current.window.webContents.id
}

/**
 * 拖拽时跟着光标走的图像
 *
 * 用随包的 icon.png，而不是 `app.getFileIcon()`：后者对 `.app` 路径只按 UTType 返回
 * 通用应用图标，拿不到本应用自己的标识
 */
function loadDragIcon(): Electron.NativeImage {
  const iconPath = resolveBundledResource('icon.png', iconAsset)

  try {
    const image = nativeImage.createFromBuffer(readFileSync(iconPath))
    return image.isEmpty()
      ? nativeImage.createEmpty()
      : image.resize({ width: 64, height: 64 })
  }
  catch {
    return nativeImage.createEmpty()
  }
}

function clearTimers(current: GuideSession): void {
  if (current.trackTimer) clearTimeout(current.trackTimer)
  if (current.pollTimer) clearInterval(current.pollTimer)
  if (current.timeoutTimer) clearTimeout(current.timeoutTimer)
  if (current.lingerTimer) clearTimeout(current.lingerTimer)
  if (current.dragResolveTimer) clearTimeout(current.dragResolveTimer)
}

type StopReason =
  | 'restart'
  | 'dismissed'
  | 'granted'
  | 'timeout'
  | 'drag-unresolved'
  | 'settings-closed'
