/** macOS keyboard-listener helper 的 NDJSON 协议：上行事件严格解码，不合法的行直接丢弃；下行命令编码 */

import type { FnModifier, KeyboardInput, KeyboardInputKey } from '@shared/shortcuts'
import { isRecord } from '@jl-org/tool'
import { KEYBOARD_CODES } from '@shared/shortcuts'

const PROTOCOL_VERSION = 2
const INPUT_FIELDS = ['fn', 'key', 'modifiers', 'phase', 'timestamp', 'type', 'v'] as const
const RESET_FIELDS = ['timestamp', 'type', 'v'] as const
const INPUT_KEYS = new Set<string>(['Fn', ...KEYBOARD_CODES])
const MODIFIERS = new Set<string>(['Control', 'Alt', 'Shift', 'Meta'])

/**
 * 解析 helper 输出的一行
 *
 * helper 只上报物理事实：`{"v":2,"type":"input","phase":"down","key":"Space","modifiers":["Meta"],"fn":true,"timestamp":123}`
 * 与 `{"v":2,"type":"reset","timestamp":123}`。字段集合必须精确匹配，多字段少字段都拒绝，
 * 避免 helper 与主进程版本错配时把半截协议当成有效输入
 */
export function decodeKeyboardListenerLine(
  line: string,
  onInvalidLine?: (reason: string) => void,
): KeyboardInput | null {
  const reject = (reason: string): null => {
    onInvalidLine?.(reason)
    return null
  }

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
    if (!hasExactFields(value, RESET_FIELDS) || !isProtocolTimestamp(value.timestamp))
      return reject('invalid_reset')

    return { phase: 'reset', timestamp: value.timestamp }
  }

  if (value.type !== 'input')
    return reject('unknown_type')
  if (!hasExactFields(value, INPUT_FIELDS))
    return reject('invalid_input_fields')
  if (value.phase !== 'down' && value.phase !== 'up')
    return reject('unknown_phase')
  if (!isProtocolTimestamp(value.timestamp))
    return reject('invalid_timestamp')
  if (typeof value.key !== 'string' || !INPUT_KEYS.has(value.key))
    return reject('unknown_key')
  if (!isModifierList(value.modifiers))
    return reject('invalid_modifiers')
  if (typeof value.fn !== 'boolean')
    return reject('invalid_fn')

  return {
    phase: value.phase,
    key: value.key as KeyboardInputKey,
    modifiers: value.modifiers,
    fn: value.fn,
    timestamp: value.timestamp,
  }
}

/**
 * 编码一行写给 helper stdin 的命令
 *
 * `config` 告诉 helper 要不要在 tap 层吞掉 🌐 键动作事件（keyCode 0xB3 的 keyDown / keyUp）；
 * Swift 侧 `KeyboardListenerCommandDecoder` 同样按字段集合精确匹配解析
 */
export function encodeKeyboardListenerCommand(command: KeyboardListenerCommand): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...command })
}

function isModifierList(value: unknown): value is FnModifier[] {
  if (!Array.isArray(value))
    return false

  const unique = new Set<string>()
  for (const modifier of value) {
    if (typeof modifier !== 'string' || !MODIFIERS.has(modifier) || unique.has(modifier))
      return false
    unique.add(modifier)
  }

  return true
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === fields.length && keys.every((key, index) => key === fields[index])
}

/**
 * 线协议的 timestamp 合法性
 *
 * helper 发的是 `UInt64(ProcessInfo.processInfo.systemUptime * 1000)`，即非负安全整数。
 * 负数、小数、越界都说明编码侧坏了，整行拒掉——坏时间戳比坏键名更难查，
 * 它不会让功能失灵，只会让 hold 与双击的判定飘掉
 *
 * 职责边界：这里只校验线上的 uptime 值；换算成 epoch 由 `backend.ts` 的 `toAppTimeBase`
 * 负责，换算后的值不再复验（偏移是主进程自己标定的，没有独立依据可校验）
 */
function isProtocolTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 主进程下发给 helper 的命令 */
export type KeyboardListenerCommand = {
  type: 'config'
  /** 为 true 时 helper 拦下系统的 🌐 键动作（表情面板 / 切输入法 / 系统听写） */
  suppressGlobeKey: boolean
}
