/** macOS 截图 helper 流式二进制协议的跨进程边界测试 */

import { describe, expect, it } from 'vitest'
import { NativeCaptureStreamParser } from './screenshot-capture-protocol'

const PROTOCOL_MAGIC = Buffer.from('ESSHOT2\n')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

describe('native screenshot stream protocol', () => {
  it('在任意 stdout 分块下完整还原多显示器帧', () => {
    const firstPng = Buffer.concat([PNG_SIGNATURE, Buffer.from('first-display')])
    const secondPng = Buffer.concat([PNG_SIGNATURE, Buffer.from('second-display')])
    const response = createResponse([
      { displayId: 7, width: 2560, height: 1440, pngBuffer: firstPng },
      { displayId: 3, width: 3024, height: 1964, pngBuffer: secondPng },
    ])
    const parser = new NativeCaptureStreamParser([3, 7])

    for (const byte of response)
      parser.push(Buffer.from([byte]))

    expect(parser.finish()).toEqual([
      { displayId: 7, width: 2560, height: 1440, pngBuffer: firstPng },
      { displayId: 3, width: 3024, height: 1964, pngBuffer: secondPng },
    ])
  })

  it('拒绝 helper 提前退出留下的截断 PNG', () => {
    const response = createResponse([
      {
        displayId: 1,
        width: 1920,
        height: 1080,
        pngBuffer: Buffer.concat([PNG_SIGNATURE, Buffer.from('payload')]),
      },
    ])
    const parser = new NativeCaptureStreamParser([1])

    parser.push(response.subarray(0, -1))

    expect(() => parser.finish()).toThrow('Truncated native screenshot response')
  })

  it('拒绝请求范围之外或重复的显示器帧', () => {
    const pngBuffer = Buffer.concat([PNG_SIGNATURE, Buffer.from('payload')])
    const unexpectedParser = new NativeCaptureStreamParser([1])

    expect(() => unexpectedParser.push(createResponse([
      { displayId: 2, width: 1920, height: 1080, pngBuffer },
    ]))).toThrow('Unexpected native screenshot display 2')

    const duplicateParser = new NativeCaptureStreamParser([1, 2])
    expect(() => duplicateParser.push(createResponse([
      { displayId: 1, width: 1920, height: 1080, pngBuffer },
      { displayId: 1, width: 1920, height: 1080, pngBuffer },
    ]))).toThrow('Unexpected native screenshot display 1')
  })

  it('在分配内存前拒绝不符合图像尺寸的超大负载声明', () => {
    const metadata = Buffer.from(JSON.stringify({
      displayId: 1,
      width: 1,
      height: 1,
      byteLength: 32 * 1024 * 1024,
    }))
    const parser = new NativeCaptureStreamParser([1])

    expect(() => parser.push(Buffer.concat([
      createHeader(1),
      encodeUInt32(metadata.length),
      metadata,
    ]))).toThrow('Native screenshot payload too large for display 1')
  })
})

function createResponse(captures: TestCapture[]): Buffer {
  return Buffer.concat([
    createHeader(captures.length),
    ...captures.flatMap((capture) => {
      const metadata = Buffer.from(JSON.stringify({
        displayId: capture.displayId,
        width: capture.width,
        height: capture.height,
        byteLength: capture.pngBuffer.length,
      }))

      return [encodeUInt32(metadata.length), metadata, capture.pngBuffer]
    }),
  ])
}

function createHeader(captureCount: number): Buffer {
  return Buffer.concat([PROTOCOL_MAGIC, encodeUInt32(captureCount)])
}

function encodeUInt32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4)
  buffer.writeUInt32BE(value)
  return buffer
}

type TestCapture = {
  displayId: number
  width: number
  height: number
  pngBuffer: Buffer
}
