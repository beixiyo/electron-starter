/**
 * 全局文本焦点检测
 *
 * 通过 Swift 子进程调用 macOS Accessibility API，
 * 检测当前前台应用是否有聚焦的文本输入元素。
 *
 * 仅支持 macOS，其他平台调用将抛出错误。
 */

import { execFile } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'

export type FocusCheckResult = {
  /** 是否有文本输入焦点 */
  focused: boolean
  /** AX 角色（AXTextField / AXTextArea / AXWebArea / AXComboBox / ...） */
  role: string | null
  /** 前台应用名称（localizedName，受系统语言影响） */
  app: string | null
  /** 前台应用 Bundle ID（如 com.microsoft.VSCode） */
  bundleId: string | null
  /** 前台应用 PID，与 process.pid 对比可可靠判断是否为自身（开发/生产均适用） */
  pid: number
}

function getBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'focus-check')
  }
  return path.join(__dirname, '../../resources/focus-check')
}

/**
 * 检测全局是否有文本输入焦点
 *
 * @returns 焦点状态（含角色和应用名）
 *
 * @example
 * ```ts
 * const result = await checkFocusedTextInput()
 * if (result.focused) {
 *   pasteText(transcription)
 * } else {
 *   showTranscriptionResult(transcription)
 * }
 * ```
 * @throws 非 macOS 平台调用时抛出
 */
export function checkFocusedTextInput(): Promise<FocusCheckResult> {
  if (process.platform !== 'darwin')
    throw new Error('[focus-check] macOS only')

  return new Promise((resolve) => {
    execFile(getBinaryPath(), [], { timeout: 500 }, (error, stdout) => {
      if (error) {
        console.warn('[focus-check] failed:', error.message)
        resolve({ focused: false, role: null, app: null, bundleId: null, pid: -1 })
        return
      }

      try {
        const result = JSON.parse(stdout.trim())
        resolve({
          focused: Boolean(result.focused),
          role: result.role ?? null,
          app: result.app ?? null,
          bundleId: result.bundleId ?? null,
          pid: Number(result.pid) || -1,
        })
      }
      catch {
        console.warn('[focus-check] parse error:', stdout)
        resolve({ focused: false, role: null, app: null, bundleId: null, pid: -1 })
      }
    })
  })
}
