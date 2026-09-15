import type {
  ShortcutChord,
  ShortcutGestureBinding,
  ShortcutGestureType,
  ShortcutRecordEvent,
} from './types'
import { DOUBLE_PRESS_INTERVAL_MS } from '../constants/hold'
import { isShortcutChordPrefixOf, shortcutChordsEqual } from './utils'

const DEFAULT_HOLD_MIN_DURATION_MS = 400

/** 创建快捷键录制状态机，消费标准化输入事件并输出最终 binding */
export function createShortcutRecordEngine(
  options: CreateShortcutRecordEngineOptions,
): ShortcutRecordEngine {
  const {
    onDetectedChange,
    onPhaseChange,
    onActiveChange,
    canDoublePress = () => true,
    doublePressIntervalMs = DOUBLE_PRESS_INTERVAL_MS,
    holdMinDurationMs = DEFAULT_HOLD_MIN_DURATION_MS,
  } = options

  let phase: ShortcutRecordDetectionPhase = 'idle'
  let supportedGestures: readonly ShortcutGestureType[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let activeChord: ShortcutChord | null = null
  let activeStartedAt = 0
  let pendingChord: ShortcutChord | null = null
  let holdDetected = false
  let completesDoublePress = false
  /** 上一次对外通报的中间态，用于去重 */
  let lastActive: ShortcutRecordActive | null = null

  const start = (nextSupportedGestures: readonly ShortcutGestureType[]): void => {
    clearRecordState()
    supportedGestures = nextSupportedGestures
    onDetectedChange(null)
    setPhase('waiting')
  }

  const cancel = (): void => {
    clearRecordState()
    supportedGestures = []
    onDetectedChange(null)
    setPhase('idle')
  }

  const reset = (): void => {
    clearRecordState()
    onDetectedChange(null)
    if (phase !== 'idle')
      setPhase('waiting')
  }

  const handle = (event: ShortcutRecordEvent): void => {
    if (event.phase === 'press') {
      handleInstantPress(event.chord)
      return
    }

    if (event.phase === 'down') {
      handleShortcutDown(event.chord, event.timestamp)
      return
    }

    handleShortcutUp(event.chord, event.timestamp)
  }

  const handleShortcutDown = (chord: ShortcutChord, timestamp: number): void => {
    if (!canAcceptInput())
      return

    /**
     * 前缀扩展（⌘ → ⌘⌥、fn → fn + ⌘、`[` → `[ + ]`）直接换成新 chord，中间不经过空态，
     * 实时回显不会闪回占位文案
     *
     * 其余在按住期间冒出来的 chord 一律忽略：主键之后才按下的修饰键本来就不参与组合，
     * 普通键之间的组合已由 tracker 合成为前缀扩展，走不到这里
     */
    if (activeChord && !isShortcutChordPrefixOf(activeChord, chord))
      return

    const isSecondPress = canFinishDoublePress(chord)

    clearTimer()
    setPendingChord(null)
    setActiveChord(chord)
    activeStartedAt = timestamp
    holdDetected = false
    completesDoublePress = isSecondPress
    setPhase('deciding')

    if (!hasGesture('hold'))
      return

    timer = setTimeout(() => {
      timer = null
      if (!activeChord || !shortcutChordsEqual(activeChord, chord))
        return

      holdDetected = true
      detect({
        gesture: 'hold',
        chord,
        minDurationMs: holdMinDurationMs,
      })
    }, holdMinDurationMs)
  }

  const handleShortcutUp = (chord: ShortcutChord, timestamp: number): void => {
    if (!activeChord || !shortcutChordsEqual(activeChord, chord))
      return

    const startedAt = activeStartedAt
    const wasHoldDetected = holdDetected
    const wasCompletingDoublePress = completesDoublePress
    clearTimer()
    clearActiveChord()

    if (wasHoldDetected)
      return

    if (wasCompletingDoublePress) {
      detect({
        gesture: 'doublePress',
        chord,
        intervalMs: doublePressIntervalMs,
      })
      return
    }

    const elapsed = Math.max(timestamp - startedAt, 0)
    if (hasGesture('hold') && elapsed >= holdMinDurationMs) {
      detect({
        gesture: 'hold',
        chord,
        minDurationMs: holdMinDurationMs,
      })
      return
    }

    finishShortPress(chord)
  }

  const handleInstantPress = (chord: ShortcutChord): void => {
    if (!canAcceptInput())
      return

    if (canFinishDoublePress(chord)) {
      detect({
        gesture: 'doublePress',
        chord,
        intervalMs: doublePressIntervalMs,
      })
      return
    }

    clearActiveChord()
    finishShortPress(chord)
  }

  const finishShortPress = (chord: ShortcutChord): void => {
    const canPress = hasGesture('press')

    /** 只有允许双击的 chord 才等待第二次按下，其余键立即判定单击 */
    if (allowsDoublePress(chord)) {
      clearTimer()
      setPendingChord(chord)
      setPhase('wait_double')
      timer = setTimeout(() => {
        timer = null
        setPendingChord(null)

        if (canPress) {
          detect({ gesture: 'press', chord })
        }
        else if (phase === 'wait_double') {
          setPhase('waiting')
        }
      }, doublePressIntervalMs)
      return
    }

    detect({ gesture: 'press', chord })
  }

  /**
   * 只对外吐出本轮允许的手势
   *
   * 长按类动作收到短按这类不接受的手势时静默回到等待：设置页不看阶段只看结果，
   * 若把不接受的手势也吐出去，它会被当成有效录制直接保存
   */
  const detect = (binding: ShortcutGestureBinding): void => {
    clearRecordState()

    if (!supportedGestures.includes(binding.gesture)) {
      setPhase('waiting')
      return
    }

    onDetectedChange({ binding })
    setPhase('detected')
  }

  const canFinishDoublePress = (chord: ShortcutChord): boolean => {
    return allowsDoublePress(chord)
      && !!pendingChord
      && shortcutChordsEqual(pendingChord, chord)
  }

  const canAcceptInput = (): boolean => {
    return phase === 'waiting'
      || phase === 'deciding'
      || phase === 'wait_double'
  }

  const hasGesture = (gesture: ShortcutGestureType): boolean => {
    return supportedGestures.includes(gesture)
  }

  const allowsDoublePress = (chord: ShortcutChord): boolean => {
    return hasGesture('doublePress') && canDoublePress(chord)
  }

  const clearRecordState = (): void => {
    clearTimer()
    clearActiveChord()
    pendingChord = null
    notifyActive()
  }

  const clearActiveChord = (): void => {
    setActiveChord(null)
    activeStartedAt = 0
    holdDetected = false
    completesDoublePress = false
  }

  const setActiveChord = (chord: ShortcutChord | null): void => {
    if (activeChord === chord)
      return

    activeChord = chord
    notifyActive()
  }

  const setPendingChord = (chord: ShortcutChord | null): void => {
    if (pendingChord === chord)
      return

    pendingChord = chord
    notifyActive()
  }

  /** 判定完成前的按键要对外可见，双击等待阶段也保持当前 chord 回显 */
  const notifyActive = (): void => {
    const chord = activeChord ?? pendingChord
    const next: ShortcutRecordActive | null = chord
      ? { chord }
      : null

    if (!next && !lastActive)
      return
    if (next && lastActive && next.chord === lastActive.chord)
      return

    lastActive = next
    onActiveChange?.(next)
  }

  const clearTimer = (): void => {
    if (!timer)
      return

    clearTimeout(timer)
    timer = null
  }

  const setPhase = (nextPhase: ShortcutRecordDetectionPhase): void => {
    phase = nextPhase
    onPhaseChange(nextPhase)
  }

  return {
    get phase() {
      return phase
    },
    start,
    cancel,
    reset,
    handle,
    dispose() {
      clearRecordState()
      supportedGestures = []
    },
  }
}

/** 快捷键录制 UI 阶段 */
export type ShortcutRecordDetectionPhase = 'idle' | 'waiting' | 'deciding' | 'wait_double' | 'detected'

/** 判定完成前的中间态：正按住的 chord，或松开后仍在等第二次按下的 chord */
export type ShortcutRecordActive = {
  chord: ShortcutChord
}

/** 一轮录制的结果：用户按了什么，合法与否由校验决定 */
export type ShortcutRecordDetection = {
  binding: ShortcutGestureBinding
}

export type CreateShortcutRecordEngineOptions = {
  /** 状态机阶段变化回调 */
  onPhaseChange: (phase: ShortcutRecordDetectionPhase) => void
  /** 录制结果变化回调；null 表示清空当前结果 */
  onDetectedChange: (detection: ShortcutRecordDetection | null) => void
  /** 判定完成前的中间态变化回调；null 表示当前没有可回显的按键 */
  onActiveChange?: (active: ShortcutRecordActive | null) => void
  /**
   * 该 chord 是否允许录成双击；返回 false 时按下即判定为单击，不再等待第二次
   * @default 全部允许
   */
  canDoublePress?: (chord: ShortcutChord) => boolean
  /** @default {@link DOUBLE_PRESS_INTERVAL_MS} */
  doublePressIntervalMs?: number
  /** @default 400 */
  holdMinDurationMs?: number
}

export type ShortcutRecordEngine = {
  /** 当前录制阶段 */
  readonly phase: ShortcutRecordDetectionPhase
  /** 开始一轮录制 */
  start: (supportedGestures: readonly ShortcutGestureType[]) => void
  /** 取消录制并清空内部状态 */
  cancel: () => void
  /** 输入源重置后清空本轮物理状态，并继续等待录制 */
  reset: () => void
  /** 消费一个标准化录制事件 */
  handle: (event: ShortcutRecordEvent) => void
  /** 释放 timer 和内部状态 */
  dispose: () => void
}
