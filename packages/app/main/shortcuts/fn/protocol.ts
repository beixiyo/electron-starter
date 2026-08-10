import type {
  FnModifier,
  FnNativeEvent,
  FnNativeInputEvent,
  FnNativeResetEvent,
  FnShortcutChord,
} from '../../../ipc/services/fn/contract'
import { FN_SHORTCUT_KEYS } from '../../../shared/shortcuts'

const PROTOCOL_VERSION = 1
const INPUT_FIELDS = ['key', 'modifiers', 'phase', 'sequence', 'timestamp', 'type', 'v'] as const
const RESET_FIELDS = ['timestamp', 'type', 'v'] as const
const FN_KEYS = new Set<string>(FN_SHORTCUT_KEYS)
const FN_MODIFIERS = new Set<FnModifier>(['Control', 'Alt', 'Shift', 'Meta'])

/** 创建严格、无异常的 Fn native NDJSON decoder，并校验物理 down/up 配对 */
export function createFnNativeProtocolDecoder(
  options: FnNativeProtocolDecoderOptions = {},
): FnNativeProtocolDecoder {
  const activeInputs = new Map<number, FnNativeInputEvent>()

  const reject = (reason: string): null => {
    options.onInvalidLine?.(reason)
    return null
  }

  const decode = (line: string): FnNativeEvent | null => {
    let value: unknown
    try {
      value = JSON.parse(line)
    }
    catch {
      return reject('invalid_json')
    }

    if (!isRecord(value))
      return reject('invalid_payload')
    if (value.v !== PROTOCOL_VERSION)
      return reject('unknown_version')

    if (value.type === 'reset') {
      if (!hasExactFields(value, RESET_FIELDS) || !isProtocolNumber(value.timestamp))
        return reject('invalid_reset')

      activeInputs.clear()
      return { type: 'reset', timestamp: value.timestamp }
    }

    if (value.type !== 'input')
      return reject('unknown_type')

    if (!hasExactFields(value, INPUT_FIELDS))
      return reject('invalid_input_fields')

    if (value.phase !== 'down' && value.phase !== 'up')
      return reject('unknown_phase')

    if (!isProtocolNumber(value.sequence) || !isProtocolNumber(value.timestamp))
      return reject('invalid_number')

    if (typeof value.key !== 'string' || !FN_KEYS.has(value.key))
      return reject('unknown_key')

    if (!isModifierList(value.modifiers))
      return reject('invalid_modifiers')

    const event: FnNativeInputEvent = {
      type: 'input',
      phase: value.phase,
      sequence: value.sequence,
      timestamp: value.timestamp,
      chord: {
        source: 'fn',
        key: value.key as FnShortcutChord['key'],
        modifiers: value.modifiers,
      },
    }

    if (event.phase === 'down') {
      if (activeInputs.has(event.sequence))
        return reject('duplicate_sequence')
      activeInputs.set(event.sequence, event)
      return event
    }

    const down = activeInputs.get(event.sequence)
    if (!down || !sameChord(down.chord, event.chord))
      return reject('unmatched_up')

    activeInputs.delete(event.sequence)
    return event
  }

  const resetGeneration = (timestamp: number): FnNativeResetEvent => {
    activeInputs.clear()
    return { type: 'reset', timestamp }
  }

  return { decode, resetGeneration }
}

function isModifierList(value: unknown): value is FnModifier[] {
  if (!Array.isArray(value))
    return false

  const unique = new Set<FnModifier>()
  for (const modifier of value) {
    if (typeof modifier !== 'string' || !FN_MODIFIERS.has(modifier as FnModifier))
      return false
    if (unique.has(modifier as FnModifier))
      return false
    unique.add(modifier as FnModifier)
  }
  return true
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === fields.length && keys.every((key, index) => key === fields[index])
}

function isProtocolNumber(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
}

function sameChord(
  left: FnNativeInputEvent['chord'],
  right: FnNativeInputEvent['chord'],
): boolean {
  const leftModifiers = left.modifiers ?? []
  const rightModifiers = right.modifiers ?? []
  return left.key === right.key
    && leftModifiers.length === rightModifiers.length
    && leftModifiers.every((modifier, index) => modifier === rightModifiers[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type FnNativeProtocolDecoder = {
  decode: (line: string) => FnNativeEvent | null
  resetGeneration: (timestamp: number) => FnNativeResetEvent
}

export type FnNativeProtocolDecoderOptions = {
  onInvalidLine?: (reason: string) => void
}
