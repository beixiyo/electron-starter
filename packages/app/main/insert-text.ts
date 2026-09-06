/** insert-text 原生辅助程序的 Node 封装：把文本直插前台 App 的焦点输入框，不经系统剪贴板 */

import { execFile } from 'node:child_process'
import { getNativeBinaryPath } from './native-bridge'

/** 粘贴路径要等目标 App 读完剪贴板再写回快照，单次约半秒；留足余量 */
const INSERT_TEXT_TIMEOUT_MS = 5_000

/**
 * 调 insert-text 直插文本；只在 macOS 可用
 *
 * 文本经 stdin 传入，避免命令行长度限制与转义问题。辅助程序缺失、超时或输出不可解析时 reject，
 * 由调用方决定回退；程序正常跑完但两条路径都失败时 resolve `ok: false` 并带回原因
 */
export function insertTextAtFocusedInput(text: string, options: InsertTextOptions = {}): Promise<InsertTextResult> {
  if (process.platform !== 'darwin')
    throw new Error('[insert-text] macOS only')

  const { method = 'auto' } = options
  const args = method === 'auto'
    ? []
    : [`--method=${method}`]

  return new Promise((resolve, reject) => {
    const child = execFile(getNativeBinaryPath('insert-text'), args, { timeout: INSERT_TEXT_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }

      try {
        const result = JSON.parse(stdout.trim())
        resolve({
          ok: Boolean(result.ok),
          method: result.method ?? null,
          reason: result.reason ?? null,
          app: result.app ?? null,
        })
      }
      catch {
        reject(new Error(`[insert-text] unexpected output: ${stdout}`))
      }
    })

    /** 辅助程序提前退出时 stdin 会 EPIPE，结果已由回调那边给出，这里只需不让它变成未捕获异常 */
    child.stdin?.on('error', () => {})
    child.stdin?.end(text, 'utf8')
  })
}

/** ax：辅助功能直写，完全不碰剪贴板；paste：快照 → 写入 → Cmd+V → 写回，用户剪贴板前后内容不变 */
export type InsertTextMethod = 'ax' | 'paste'

export type InsertTextOptions = {
  /**
   * 只走指定路径，用于排查各 App 的兼容矩阵
   * @default 'auto'
   */
  method?: InsertTextMethod | 'auto'
}

export type InsertTextResult = {
  ok: boolean
  /** 成功时实际生效的路径 */
  method: InsertTextMethod | null
  /** 失败原因，成功时为 null */
  reason: string | null
  /** 前台 App 名，便于排查 */
  app: string | null
}
