/**
 * fn/Globe 键监听核心模块
 *
 * 负责启动 Swift 子进程（IOHIDManager），解析 stdout 输出（FN_DOWN / FN_UP），
 * 并通过事件监听器机制向上层暴露原始的 down/up 事件。
 *
 * 仅支持 macOS，其他平台调用任意公开函数将抛出错误。
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'

export type FnKeyEvent = 'down' | 'up'
export type FnKeyListener = (event: FnKeyEvent) => void
export type FnComboListener = (key: string) => void

let child: ChildProcess | null = null
const listeners = new Set<FnKeyListener>()
const comboListeners = new Set<FnComboListener>()

/**
 * 获取 fn-listener 二进制文件路径
 * - 打包后：process.resourcesPath/fn-listener
 * - 开发时：__dirname 指向 out/main/，上溯两级到项目根，再进入 resources/
 */
function getBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'fn-listener')
  }

  return path.join(__dirname, '../../resources/fn-listener')
}

function emit(event: FnKeyEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

function emitCombo(key: string): void {
  for (const listener of comboListeners) {
    listener(key)
  }
}

/**
 * 启动 fn-listener Swift 子进程。
 * - 已运行时：静默跳过（幂等）
 * @throws 非 macOS 平台调用时抛出
 */
export function startFnKeyListener(): void {
  if (process.platform !== 'darwin')
    throw new Error('[fn-listener] macOS only')
  if (child !== null)
    return

  const binaryPath = getBinaryPath()

  child = spawn(binaryPath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (data: string) => {
    for (const line of data.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === 'FN_DOWN')
        emit('down')
      else if (trimmed === 'FN_UP')
        emit('up')
      else if (trimmed.startsWith('FN_COMBO_'))
        emitCombo(trimmed.slice(9))
    }
  })

  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (data: string) => {
    for (const line of data.split('\n')) {
      const trimmed = line.trim()
      if (trimmed)
        console.log(`[fn-listener] ${trimmed}`)
    }
  })

  child.on('exit', (code, signal) => {
    console.warn(`[fn-listener] 进程退出: code=${code} signal=${signal}`)
    child = null
  })
}

/**
 * 停止 fn-listener Swift 子进程
 * @throws 非 macOS 平台调用时抛出
 */
export function stopFnKeyListener(): void {
  if (process.platform !== 'darwin')
    throw new Error('[fn-listener] macOS only')
  if (child === null)
    return
  child.kill()
  child = null
}

/**
 * 注册 fn 键事件监听器
 * @param listener 回调函数，接收 'down' | 'up' 事件类型
 * @returns 取消订阅函数
 * @throws 非 macOS 平台调用时抛出
 */
export function addFnKeyListener(listener: FnKeyListener): () => void {
  if (process.platform !== 'darwin')
    throw new Error('[fn-listener] macOS only')
  listeners.add(listener)
  return () => removeFnKeyListener(listener)
}

/**
 * 移除 fn 键事件监听器
 * @param listener 之前注册的回调函数
 * @throws 非 macOS 平台调用时抛出
 */
export function removeFnKeyListener(listener: FnKeyListener): void {
  if (process.platform !== 'darwin')
    throw new Error('[fn-listener] macOS only')
  listeners.delete(listener)
}

/**
 * 注册 Fn+Key combo 事件监听器
 * Swift 二进制在 HID 层检测 Fn+Key 组合后输出 FN_COMBO_<key>，
 * 此处解析后以 key 名（如 'Space'）回调。
 * @throws 非 macOS 平台调用时抛出
 */
export function addFnComboListener(listener: FnComboListener): () => void {
  if (process.platform !== 'darwin')
    throw new Error('[fn-listener] macOS only')
  comboListeners.add(listener)
  return () => comboListeners.delete(listener)
}
