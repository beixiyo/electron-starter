/**
 * 主进程侧的 IPC 二进制载荷工具
 */

/**
 * 把 Node Buffer 转成可过 IPC 的 ArrayBuffer，避免整块数据的中间拷贝
 *
 * Node 对不超过 4KB（`Buffer.poolSize >>> 1`）的分配会复用 Buffer 池，
 * 此时 `buffer.buffer` 拿到的是整个池（byteOffset 不为 0 或长度对不上），
 * 直接交给结构化克隆会把池里无关字节一并发给 renderer，必须精确切片；
 * 更大的分配独占底层 ArrayBuffer（fs.readFile 大文件、nativeImage.toPNG 等），
 * 直接复用即可，零拷贝
 */
export function toIpcArrayBuffer(buffer: Buffer): ArrayBuffer {
  const raw = buffer.buffer
  if (raw instanceof ArrayBuffer && buffer.byteOffset === 0 && buffer.byteLength === raw.byteLength) return raw

  return raw.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}
