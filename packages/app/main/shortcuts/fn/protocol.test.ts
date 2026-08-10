import { describe, expect, it, vi } from 'vitest'
import { createFnNativeProtocolDecoder } from './protocol'

describe('fn native NDJSON decoder', () => {
  it('保留合法 input down/up 的 sequence、timestamp 和 chord', () => {
    const decoder = createFnNativeProtocolDecoder()
    vi.spyOn(Date, 'now').mockReturnValue(999_999)

    const down = decoder.decode(inputLine({
      phase: 'down',
      sequence: 104,
      timestamp: 123_456_820,
      key: 'Space',
      modifiers: ['Meta'],
    }))
    const up = decoder.decode(inputLine({
      phase: 'up',
      sequence: 104,
      timestamp: 123_456_960,
      key: 'Space',
      modifiers: ['Meta'],
    }))

    expect(down).toEqual({
      type: 'input',
      phase: 'down',
      sequence: 104,
      timestamp: 123_456_820,
      chord: { source: 'fn', key: 'Space', modifiers: ['Meta'] },
    })
    expect(up).toEqual({
      type: 'input',
      phase: 'up',
      sequence: 104,
      timestamp: 123_456_960,
      chord: { source: 'fn', key: 'Space', modifiers: ['Meta'] },
    })
    expect(down?.timestamp).not.toBe(Date.now())
    vi.restoreAllMocks()
  })

  it('解析合法 reset 并清理旧 sequence', () => {
    const decoder = createFnNativeProtocolDecoder()
    decoder.decode(inputLine({ phase: 'down', sequence: 1, timestamp: 10 }))

    expect(decoder.decode(JSON.stringify({ v: 1, type: 'reset', timestamp: 20 })))
      .toEqual({ type: 'reset', timestamp: 20 })
    expect(decoder.decode(inputLine({ phase: 'up', sequence: 1, timestamp: 30 })))
      .toBeNull()
  })

  it('helper generation reset 清理 active sequence', () => {
    const decoder = createFnNativeProtocolDecoder()
    decoder.decode(inputLine({ phase: 'down', sequence: 7, timestamp: 10 }))

    expect(decoder.resetGeneration(15)).toEqual({ type: 'reset', timestamp: 15 })
    expect(decoder.decode(inputLine({ phase: 'up', sequence: 7, timestamp: 20 })))
      .toBeNull()
  })

  it.each([
    ['未知 version', { v: 2, type: 'reset', timestamp: 1 }],
    ['未知 type', { v: 1, type: 'gesture', timestamp: 1 }],
    ['未知 phase', inputPayload({ phase: 'press' })],
    ['未知 key', inputPayload({ key: 'Unknown' })],
    ['未知 modifier', inputPayload({ modifiers: ['Primary'] })],
    ['重复 modifier', inputPayload({ modifiers: ['Meta', 'Meta'] })],
    ['非有限 timestamp', inputPayload({ timestamp: Number.POSITIVE_INFINITY })],
    ['非有限 sequence', inputPayload({ sequence: Number.NaN })],
    ['非整数 sequence', inputPayload({ sequence: 1.5 })],
    ['缺失字段', { v: 1, type: 'input', phase: 'down' }],
    ['多余字段', { ...inputPayload(), action: 'voice-ime' }],
  ])('%s 会 fail closed', (_name, payload) => {
    const invalidReasons: string[] = []
    const decoder = createFnNativeProtocolDecoder({
      onInvalidLine: reason => invalidReasons.push(reason),
    })

    expect(() => decoder.decode(JSON.stringify(payload))).not.toThrow()
    expect(decoder.decode(JSON.stringify(payload))).toBeNull()
    expect(invalidReasons.length).toBeGreaterThan(0)
  })

  it('畸形 JSON 不抛异常', () => {
    const decoder = createFnNativeProtocolDecoder()
    expect(() => decoder.decode('{')).not.toThrow()
    expect(decoder.decode('{')).toBeNull()
  })

  it('up 必须与 active down 的 sequence 和冻结 chord 匹配', () => {
    const decoder = createFnNativeProtocolDecoder()
    decoder.decode(inputLine({
      phase: 'down',
      sequence: 3,
      timestamp: 10,
      key: 'Space',
      modifiers: ['Meta'],
    }))

    expect(decoder.decode(inputLine({
      phase: 'up',
      sequence: 3,
      timestamp: 20,
      key: 'Space',
      modifiers: [],
    }))).toBeNull()
    expect(decoder.decode(inputLine({
      phase: 'up',
      sequence: 4,
      timestamp: 20,
      key: 'Space',
      modifiers: ['Meta'],
    }))).toBeNull()
  })
})

function inputLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(inputPayload(overrides))
}

function inputPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    type: 'input',
    phase: 'down',
    sequence: 1,
    timestamp: 1,
    key: 'Fn',
    modifiers: [],
    ...overrides,
  }
}
