/** macOS screenshot-capture helper 的逐帧二进制响应协议 */

const NATIVE_CAPTURE_MAGIC = Buffer.from('ESSHOT2\n')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const RESPONSE_HEADER_BYTES = NATIVE_CAPTURE_MAGIC.length + 4
const MAX_CAPTURE_COUNT = 32
const MAX_METADATA_BYTES = 64 * 1024
const MAX_IMAGE_DIMENSION = 32_768
const MAX_FRAME_BYTES = 512 * 1024 * 1024
const PNG_OVERHEAD_ALLOWANCE_BYTES = 16 * 1024 * 1024

/**
 * 增量解析 helper stdout；每个 PNG 只在跨多个 stdout chunk 时复制一次，
 * 不再把所有显示器响应先合并成一个大 Buffer
 */
export class NativeCaptureStreamParser {
  private readonly queue = new BufferQueue()
  private readonly expectedDisplayIds: Set<number>
  private readonly captures: NativeDisplayCapture[] = []
  private captureCount: number | null = null
  private metadataLength: number | null = null
  private pendingMetadata: NativeCaptureMetadata | null = null
  private completed = false

  constructor(expectedDisplayIds: number[]) {
    this.expectedDisplayIds = new Set(expectedDisplayIds)
    if (
      expectedDisplayIds.length === 0
      || this.expectedDisplayIds.size !== expectedDisplayIds.length
      || expectedDisplayIds.some(displayId => !isPositiveInteger(displayId))
    ) {
      throw new Error('Invalid expected native screenshot display IDs')
    }
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0)
      return
    if (this.completed)
      throw new Error('Unexpected trailing bytes in native screenshot response')

    this.queue.push(chunk)
    this.drain()
  }

  finish(): NativeDisplayCapture[] {
    this.drain()
    if (!this.completed)
      throw new Error('Truncated native screenshot response')
    if (this.queue.byteLength !== 0)
      throw new Error('Unexpected trailing bytes in native screenshot response')

    return this.captures
  }

  private drain(): void {
    if (this.captureCount === null) {
      const header = this.queue.read(RESPONSE_HEADER_BYTES)
      if (!header)
        return
      if (!header.subarray(0, NATIVE_CAPTURE_MAGIC.length).equals(NATIVE_CAPTURE_MAGIC))
        throw new Error('Invalid native screenshot response header')

      const captureCount = header.readUInt32BE(NATIVE_CAPTURE_MAGIC.length)
      if (
        captureCount === 0
        || captureCount > MAX_CAPTURE_COUNT
        || captureCount !== this.expectedDisplayIds.size
      ) {
        throw new Error('Invalid native screenshot capture count')
      }
      this.captureCount = captureCount
    }

    while (this.captures.length < this.captureCount) {
      if (this.pendingMetadata === null) {
        if (this.metadataLength === null) {
          const metadataLength = this.queue.read(4)
          if (!metadataLength)
            return
          this.metadataLength = metadataLength.readUInt32BE(0)
          if (this.metadataLength === 0 || this.metadataLength > MAX_METADATA_BYTES)
            throw new Error('Invalid native screenshot metadata length')
        }

        const metadataData = this.queue.read(this.metadataLength)
        if (!metadataData)
          return
        this.pendingMetadata = parseMetadata(metadataData.toString('utf8'))
        this.metadataLength = null

        if (
          !this.expectedDisplayIds.has(this.pendingMetadata.displayId)
          || this.captures.some(capture => capture.displayId === this.pendingMetadata?.displayId)
        ) {
          throw new Error(`Unexpected native screenshot display ${this.pendingMetadata.displayId}`)
        }
      }

      const pngBuffer = this.queue.read(this.pendingMetadata.byteLength)
      if (!pngBuffer)
        return
      if (!pngBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
        throw new Error(`Invalid PNG payload for display ${this.pendingMetadata.displayId}`)

      this.captures.push({
        displayId: this.pendingMetadata.displayId,
        width: this.pendingMetadata.width,
        height: this.pendingMetadata.height,
        pngBuffer,
      })
      this.pendingMetadata = null
    }

    this.completed = true
    if (this.queue.byteLength !== 0)
      throw new Error('Unexpected trailing bytes in native screenshot response')
  }
}

function parseMetadata(json: string): NativeCaptureMetadata {
  const value: unknown = JSON.parse(json)
  if (
    !isRecord(value)
    || !isPositiveInteger(value.displayId)
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || !isPositiveInteger(value.byteLength)
    || value.width > MAX_IMAGE_DIMENSION
    || value.height > MAX_IMAGE_DIMENSION
  ) {
    throw new Error('Invalid native screenshot capture metadata')
  }

  const rawImageBytes = value.width * value.height * 4
  const maxPayloadBytes = Math.min(
    MAX_FRAME_BYTES,
    rawImageBytes + PNG_OVERHEAD_ALLOWANCE_BYTES,
  )
  if (value.byteLength > maxPayloadBytes)
    throw new Error(`Native screenshot payload too large for display ${value.displayId}`)

  return {
    displayId: value.displayId,
    width: value.width,
    height: value.height,
    byteLength: value.byteLength,
  }
}

class BufferQueue {
  private readonly chunks: Buffer[] = []
  byteLength = 0

  push(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.byteLength += chunk.length
  }

  read(size: number): Buffer | null {
    if (this.byteLength < size)
      return null
    if (size === 0)
      return Buffer.alloc(0)

    const first = this.chunks[0]
    if (!first)
      return null

    if (first.length === size) {
      this.chunks.shift()
      this.byteLength -= size
      return first
    }

    if (first.length > size) {
      const result = first.subarray(0, size)
      this.chunks[0] = first.subarray(size)
      this.byteLength -= size
      return result
    }

    const result = Buffer.allocUnsafe(size)
    let offset = 0
    while (offset < size) {
      const chunk = this.chunks[0]
      if (!chunk)
        return null

      const remaining = size - offset
      const copied = Math.min(chunk.length, remaining)
      chunk.copy(result, offset, 0, copied)
      offset += copied

      if (copied === chunk.length)
        this.chunks.shift()
      else
        this.chunks[0] = chunk.subarray(copied)
    }

    this.byteLength -= size
    return result
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export type NativeDisplayCapture = {
  displayId: number
  width: number
  height: number
  pngBuffer: Buffer
}

type NativeCaptureMetadata = {
  displayId: number
  width: number
  height: number
  byteLength: number
}
