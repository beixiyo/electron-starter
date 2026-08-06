import { nanoid } from 'nanoid'

/** 生成跨运行环境可用的随机 ID */
export function generateRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function')
    return globalThis.crypto.randomUUID()

  return nanoid()
}
