/** insert-text 原生辅助程序的 Node 封装：把文本直插前台 App 的焦点输入框，用户剪贴板前后内容不变 */

import { execFile } from 'node:child_process'
import { getNativeBinaryPath } from './native-bridge'

/**
 * 粘贴路径最多等 1.5 s 第一次回执、回执后再等 200 ms 静默、回执不断时 3 s 封顶（见 InsertText/main.swift 头部）；
 * 再加进程启动与 AX 直写，留足余量
 */
const INSERT_TEXT_TIMEOUT_MS = 5_000

/**
 * 粘贴路径在预算内没有任何进程读剪贴板：没人读一定没粘，文本没送达，剪贴板已还原
 *
 * 这是唯一「辅助程序一切正常、只是没人接」的失败原因，调用方据它视为没有落点，**不得**再退到裸粘贴——
 * 那等于把刚被证明没人接的 Cmd+V 再盲发一次，还把待插入文本留在用户剪贴板里
 * 注意反过来不成立：收到回执不代表粘进去了（Chrome body、Safari 空白页、系统设置侧栏都会读却不落字），
 * 能不能投由 focus-check 的 AX 判定决定
 */
export const PASTE_NOT_CONSUMED_REASON = 'paste-not-consumed'

/**
 * 调 insert-text 直插文本；只在 macOS 可用
 *
 * 文本经 stdin 传入，避免命令行长度限制与转义问题。辅助程序缺失、超时或输出不可解析时 reject，
 * 由调用方决定回退；程序正常跑完但没送达时 resolve `ok: false` 并带回原因
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
          receiptMs: typeof result.receiptMs === 'number'
            ? result.receiptMs
            : null,
          receiptCount: Number(result.receiptCount) || 0,
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

/**
 * ax：辅助功能直写，完全不碰剪贴板；paste：快照 → 惰性承诺 → Cmd+V → 等目标读取的回执 → 写回，
 * 用户剪贴板前后内容不变；预算内没人读剪贴板报 `paste-not-consumed`
 */
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
  /** 失败原因，成功时为 null；{@link PASTE_NOT_CONSUMED_REASON} 表示没有落点而非程序故障 */
  reason: string | null
  /** 前台 App 名，便于排查 */
  app: string | null
  /** 粘贴路径：从发出 Cmd+V 到目标第一次读取剪贴板的毫秒数；直写成功或没有回执时为 null */
  receiptMs: number | null
  /** 粘贴路径：Cmd+V 之后收到的读取回执总数（Chromium 会先探后读，不止一次） */
  receiptCount: number
}
