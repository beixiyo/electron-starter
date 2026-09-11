/**
 * keyboard-listener NDJSON v2 解码边界
 *
 * 守的是一次真机故障：helper 升到 v2 之后主进程的 `PROTOCOL_VERSION` 仍是 1，
 * 每一行都被当成版本错配丢掉，Fn 快捷键整条链路静默失效且没有任何异常
 * 所以版本、字段集合、键名与 modifier 的判定都必须有用例钉住，而且必须 fail closed
 *
 * **本文件里的字节串都是字面量，不许用 `JSON.stringify` 拼。** 这是跨语言线协议，
 * 按「我以为的格式」反推期望值的话，两侧同时漂移也能全绿。下面 GOLDEN_* 两行
 * 与 `native/mac/accessibility/Tests/Tests/KeyboardListenerCoreTests/KeyboardListenerEventEncoderTests.swift`
 * 里 `#expect(encoded == ...)` 的两行逐字相同（Swift 编码器设了 `.sortedKeys`，输出确定）；
 * 改协议要同时改这两个文件，任一侧单独改字段名都会让其中一边红
 */

import { describe, expect, it } from 'vitest'
import { decodeKeyboardListenerLine } from './protocol'

/** 与 Swift `input编码为单行NDJSON对象` 的期望值逐字相同 */
const GOLDEN_INPUT_LINE = '{"fn":true,"key":"Space","modifiers":["Meta"],"phase":"down","timestamp":123,"type":"input","v":2}'
/** 与 Swift `reset只包含协议要求字段` 的期望值逐字相同 */
const GOLDEN_RESET_LINE = '{"timestamp":456,"type":"reset","v":2}'

describe('keyboard-listener NDJSON 解码', () => {
  it('解码 Swift 编码器的黄金样本', () => {
    expect(decodeKeyboardListenerLine(GOLDEN_INPUT_LINE)).toEqual({
      phase: 'down',
      key: 'Space',
      modifiers: ['Meta'],
      fn: true,
      timestamp: 123,
    })
    expect(decodeKeyboardListenerLine(GOLDEN_RESET_LINE)).toEqual({
      phase: 'reset',
      timestamp: 456,
    })
  })

  it('Fn 自身与带侧别的修饰键都在键名空间内', () => {
    expect(decodeKeyboardListenerLine(
      '{"fn":false,"key":"Fn","modifiers":[],"phase":"down","timestamp":1,"type":"input","v":2}',
    )).toEqual({ phase: 'down', key: 'Fn', modifiers: [], fn: false, timestamp: 1 })

    expect(decodeKeyboardListenerLine(
      '{"fn":false,"key":"MetaRight","modifiers":["Meta"],"phase":"up","timestamp":2,"type":"input","v":2}',
    )).toEqual({ phase: 'up', key: 'MetaRight', modifiers: ['Meta'], fn: false, timestamp: 2 })
  })

  /**
   * 每一行都是一种真实会从 helper 那边过来的坏输入：版本错配、v1 残留字段、
   * v1 键名空间、被中途截断的行、以及编码器写错字段类型
   * 断言具体 reason 而不只是 null —— 校验走错分支也要能看出来
   */
  it.each([
    ['v1 的 input 行（本期真实故障）', '{"fn":false,"key":"A","modifiers":[],"phase":"down","timestamp":1,"type":"input","v":1}', 'unknown_version'],
    ['v1 的 reset 行', '{"timestamp":1,"type":"reset","v":1}', 'unknown_version'],
    ['非对象 JSON：null', 'null', 'invalid_payload'],
    ['非对象 JSON：数组', '[]', 'invalid_payload'],
    ['非对象 JSON：裸数字', '3', 'invalid_payload'],
    ['未知 type', '{"timestamp":1,"type":"gesture","v":2}', 'unknown_type'],
    ['reset 多字段', '{"phase":"reset","timestamp":1,"type":"reset","v":2}', 'invalid_reset'],
    ['reset 少字段', '{"type":"reset","v":2}', 'invalid_reset'],
    ['input 少字段（缺 fn）', '{"key":"A","modifiers":[],"phase":"down","timestamp":1,"type":"input","v":2}', 'invalid_input_fields'],
    ['input 残留 v1 的 sequence', '{"fn":false,"key":"A","modifiers":[],"phase":"down","sequence":1,"timestamp":1,"type":"input","v":2}', 'invalid_input_fields'],
    ['未知 phase', '{"fn":false,"key":"A","modifiers":[],"phase":"press","timestamp":1,"type":"input","v":2}', 'unknown_phase'],
    ['timestamp 为负', '{"fn":false,"key":"A","modifiers":[],"phase":"down","timestamp":-1,"type":"input","v":2}', 'invalid_timestamp'],
    ['timestamp 非整数', '{"fn":false,"key":"A","modifiers":[],"phase":"down","timestamp":1.5,"type":"input","v":2}', 'invalid_timestamp'],
    ['v1 键名空间的 Grave', '{"fn":false,"key":"Grave","modifiers":[],"phase":"down","timestamp":1,"type":"input","v":2}', 'unknown_key'],
    ['key 不是字符串', '{"fn":false,"key":1,"modifiers":[],"phase":"down","timestamp":1,"type":"input","v":2}', 'unknown_key'],
    ['modifiers 不是数组', '{"fn":false,"key":"A","modifiers":"Meta","phase":"down","timestamp":1,"type":"input","v":2}', 'invalid_modifiers'],
    ['modifiers 含抽象修饰键', '{"fn":false,"key":"A","modifiers":["Primary"],"phase":"down","timestamp":1,"type":"input","v":2}', 'invalid_modifiers'],
    ['modifiers 重复', '{"fn":false,"key":"A","modifiers":["Meta","Meta"],"phase":"down","timestamp":1,"type":"input","v":2}', 'invalid_modifiers'],
    ['fn 不是布尔', '{"fn":1,"key":"A","modifiers":[],"phase":"down","timestamp":1,"type":"input","v":2}', 'invalid_fn'],
    ['被截断的行', '{"fn":false,"key":"A","modi', 'invalid_json'],
  ])('%s → fail closed', (_name, line, expectedReason) => {
    const reasons: string[] = []

    expect(() => decodeKeyboardListenerLine(line)).not.toThrow()
    expect(decodeKeyboardListenerLine(line, reason => reasons.push(reason))).toBeNull()
    expect(reasons).toEqual([expectedReason])
  })
})
