/// <reference types="vite/client" />

/**
 * 跨 Node 与 Vite 读取当前运行模式的通用环境工具
 */

/**
 * 是否处于开发模式
 */
export function isDev(): boolean {
  if (typeof globalThis.process !== 'undefined')
    return globalThis.process.env.NODE_ENV === 'development'

  return import.meta.env.MODE === 'development'
}

/**
 * 是否处于生产模式
 */
export function isProd(): boolean {
  if (typeof globalThis.process !== 'undefined')
    return globalThis.process.env.NODE_ENV === 'production'

  return import.meta.env.MODE === 'production'
}
