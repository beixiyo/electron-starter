/** macOS 键盘捕获后端：keyboard-listener Swift helper 的进程生命周期与健康状态 */

import type { KeyboardInput } from '@shared/shortcuts'
import type { KeyboardInputBackend } from '../backend'
import { existsSync } from 'node:fs'
import { getAppAccessibilityStatus, getKeyboardListenerAccessibilityStatus } from '@main/permissions'
import { createMainDiagnosticLogger } from '../../../logging'
import { getNativeBinaryPath, NativeBridge } from '../../../native-bridge'
import { requestShortcutRuntimeSync } from '../../runtime-sync'
import { createKeyboardInputListeners } from '../backend'
import { decodeKeyboardListenerLine, encodeKeyboardListenerCommand } from './protocol'

const HELPER_NAME = 'keyboard-listener'
const RECOVERY_DELAY_MS = 5_000
const log = createMainDiagnosticLogger('shortcut.runtime')

let refCount = 0
let health: KeyboardListenerHealth = 'unknown'
let recoveryTimer: ReturnType<typeof setTimeout> | null = null
/**
 * 当代 helper 的 uptime 毫秒 → epoch 毫秒的偏移，`null` 表示本代还没标定
 *
 * helper 报的是 `ProcessInfo.processInfo.systemUptime`（开机以来），而 DOM 后端与
 * uIOhook 后端报的是 `Date.now()`。两种基准混进同一个录制/手势状态机会差出上千亿毫秒，
 * 所以在这里按「第一条事件到达的瞬间」一次标定，后续事件只做平移 ——
 * 平移保留 helper 自己的相对间隔（tap 回调里取的时刻比 IPC 到达时刻更准），
 * 只把绝对基准对齐到 epoch。重启换代要重新标定，因此 uptime 不会跨代错位
 */
let uptimeToEpochOffsetMs: number | null = null
let missingBinaryReported = false
/** helper 二进制是否存在；`null` 表示还没查过 */
let helperBinaryExists: boolean | null = null
/** 期望状态留在主进程：helper 崩溃重启后靠它重新下发，helper 自身启动时恒为不抑制 */
let globeKeySuppressed = false
const listeners = createKeyboardInputListeners()

const bridge = new NativeBridge<Record<string, never>>({
  name: HELPER_NAME,
  /** stdin 是下行通道：config 命令告诉 helper 要不要吞 🌐 键动作 */
  writable: true,
  logStderr: true,
  onUnexpectedExit: handleUnexpectedExit,
  parseLine(line) {
    const input = decodeKeyboardListenerLine(line, (reason) => {
      log.warn('keyboard-listener.invalid-line', 'ignored invalid keyboard-listener line', { reason })
    })
    if (input)
      listeners.emit(toAppTimeBase(input))
  },
})

export const nativeMacKeyboardInputBackend: KeyboardInputBackend = {
  id: 'native-mac',
  isAvailable,
  acquire,
  release,
  sync,
  subscribe: listeners.add,
  setGlobeKeySuppressed,
  shutdown: stop,
}

/**
 * helper 是独立进程，有自己的 TCC 信任记录：主 App 已授权不代表 helper 已授权，
 * 两者都要满足；异常退出后进入恢复窗口，期间视为不可用
 */
function isAvailable(): boolean {
  return process.platform === 'darwin'
    && health !== 'unavailable'
    && hasHelperBinary()
    && getAppAccessibilityStatus() === 'granted'
    && getKeyboardListenerAccessibilityStatus() === 'granted'
}

/**
 * helper 二进制是否存在
 *
 * `resources/native/mac/` 是 gitignore 的构建产物，fresh clone 不跑
 * `pnpm build:native:mac` 就没有这个文件。不前置判断的话 spawn 会 ENOENT，
 * 而 ENOENT 走的是和「helper 崩了」同一条 `onUnexpectedExit`，于是每 5 秒
 * 重试一次、每次带一轮全量 reapply 和一条 error 日志，永远不会成功
 * 这里把它变成一次明确的告警 + 稳定的「后端不可用」，降级路径与权限缺失一致
 *
 * 结果按进程缓存：缺的是构建产物，补上要重新构建并重启，不值得每次 `isAvailable()` 去 stat
 */
function hasHelperBinary(): boolean {
  if (helperBinaryExists === null) {
    helperBinaryExists = existsSync(getNativeBinaryPath(HELPER_NAME))

    if (!helperBinaryExists && !missingBinaryReported) {
      missingBinaryReported = true
      log.error(
        'keyboard-listener.binary-missing',
        'keyboard-listener helper binary not found, system-level shortcuts stay disabled until it is built',
        new Error(`missing native helper: ${getNativeBinaryPath(HELPER_NAME)}`),
      )
    }
  }

  return helperBinaryExists
}

function acquire(): void {
  if (!isAvailable())
    throw new Error('keyboard-listener requires macOS accessibility permission')

  refCount++
  start()
}

function release(): void {
  if (refCount <= 0)
    return
  refCount--
}

/** 权限被收回时停掉 helper；权限恢复且仍有消费者时重新拉起 */
function sync(): void {
  if (!isAvailable()) {
    stop()
    return
  }

  if (refCount > 0)
    start()
}

function start(): void {
  if (bridge.running)
    return

  health = 'healthy'
  uptimeToEpochOffsetMs = null
  clearRecoveryTimer()
  /** 新一代 helper 的物理状态从零开始，消费方先清掉上一代残留的按键 */
  emitReset()
  bridge.start()
  /** helper 自身启动时恒为不抑制，只有期望抑制时才需要补发 */
  if (globeKeySuppressed)
    sendGlobeKeyConfig()
}

function setGlobeKeySuppressed(suppressed: boolean): void {
  if (globeKeySuppressed === suppressed)
    return

  globeKeySuppressed = suppressed
  sendGlobeKeyConfig()
}

/** helper 没在跑就不写：期望状态已记下，下次 {@link start} 会补发 */
function sendGlobeKeyConfig(): void {
  if (!bridge.running)
    return

  bridge.send(encodeKeyboardListenerCommand({ type: 'config', suppressGlobeKey: globeKeySuppressed }))
}

function stop(): void {
  if (!bridge.running)
    return

  emitReset()
  bridge.stop()
}

function handleUnexpectedExit(): void {
  health = 'unavailable'
  uptimeToEpochOffsetMs = null
  emitReset()
  requestShortcutRuntimeSync()

  if (recoveryTimer)
    return

  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    health = 'unknown'
    requestShortcutRuntimeSync()
  }, RECOVERY_DELAY_MS)
  recoveryTimer.unref?.()
}

/** 把 helper 的 uptime 毫秒平移到 epoch 毫秒，理由见 {@link uptimeToEpochOffsetMs} */
function toAppTimeBase(input: KeyboardInput): KeyboardInput {
  if (uptimeToEpochOffsetMs === null)
    uptimeToEpochOffsetMs = Date.now() - input.timestamp

  return { ...input, timestamp: input.timestamp + uptimeToEpochOffsetMs }
}

/** 主进程自己造的 reset 直接用 epoch，与 {@link toAppTimeBase} 归一后的事件同基 */
function emitReset(): void {
  listeners.emit({ phase: 'reset', timestamp: Date.now() })
}

function clearRecoveryTimer(): void {
  if (!recoveryTimer)
    return

  clearTimeout(recoveryTimer)
  recoveryTimer = null
}

type KeyboardListenerHealth = 'unknown' | 'healthy' | 'unavailable'
