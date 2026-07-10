import type { WindowType } from '@shared'
import type { HoldStartConfig, HoldState, SerializableHoldState } from './types'
import { INTERNAL_HOLD_NO_WINDOW } from './types'

class HoldStateManager {
  private holdStates: Map<WindowType | typeof INTERNAL_HOLD_NO_WINDOW, HoldState> = new Map()

  startHold(config: HoldStartConfig): void {
    const { type, onRelease } = config
    const holdType = type ?? INTERNAL_HOLD_NO_WINDOW

    this.holdStates.set(holdType, {
      isHolding: true,
      startTime: Date.now(),
      windowType: holdType,
      onRelease,
    })
  }

  completeHold(type: WindowType | undefined, result?: unknown): HoldState | undefined {
    const holdType = type ?? INTERNAL_HOLD_NO_WINDOW
    const holdState = this.holdStates.get(holdType)

    if (!holdState) {
      return undefined
    }

    holdState.onRelease?.(result)
    this.holdStates.delete(holdType)
    return holdState
  }

  isHolding(type?: WindowType): boolean {
    const holdType = type ?? INTERNAL_HOLD_NO_WINDOW
    return this.holdStates.get(holdType)?.isHolding ?? false
  }

  getHoldState(type?: WindowType): HoldState | undefined {
    const holdType = type ?? INTERNAL_HOLD_NO_WINDOW
    return this.holdStates.get(holdType)
  }

  getSerializableHoldState(type?: WindowType): SerializableHoldState | undefined {
    const holdType = type ?? INTERNAL_HOLD_NO_WINDOW
    const holdState = this.holdStates.get(holdType)
    if (!holdState) {
      return undefined
    }

    return {
      isHolding: holdState.isHolding,
      startTime: holdState.startTime,
      windowType: holdState.windowType,
    }
  }

  clearAll(): void {
    this.holdStates.clear()
  }
}

export const holdStateManager = new HoldStateManager()
