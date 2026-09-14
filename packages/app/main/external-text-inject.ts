/** 外部 App 输入框的文本投递策略：macOS 优先原生直插，辅助程序不可用或非 macOS 回退到剪贴板粘贴 */

import { insertTextAtFocusedInput, PASTE_NOT_CONSUMED_REASON } from './insert-text'
import { pasteText } from './utils'

/**
 * 把文本投进前台外部 App 的焦点输入框
 *
 * 直接调 pasteText 会把待插入文本留在用户剪贴板里、覆盖用户原先复制的内容。macOS 上由
 * `insert-text` 辅助程序先试辅助功能直写，不行再做「快照 → 惰性承诺 → Cmd+V → 等回执 → 写回」，
 * 用户剪贴板前后不变
 *
 * 结果分三种，调用方要区分对待：
 * - `delivered: true`：AX 直写校验过值变了，或粘贴后有进程读了剪贴板。后者不是送达证明（读了不等于粘了），
 *   前提是调用方已用 focus-check 的 AX 判定确认有落点
 * - `delivered: false`：辅助程序正常跑完，但预算内没有任何进程读剪贴板——一定没粘，
 *   文本没丢（剪贴板已还原），交回上层 UI。**不**退裸粘贴：那只是把刚被证明没人接的 Cmd+V 再盲发一次
 * - 辅助程序缺失 / 崩溃 / 超时或非 macOS：退裸粘贴 `clipboard`，文本永远送达，代价是留在用户剪贴板
 */
export async function injectTextToExternalInput(
  text: string,
  options: InjectTextToExternalInputOptions = {},
): Promise<ExternalTextInjectOutcome> {
  const { platform = process.platform } = options
  let fallbackReason: string | null = null

  if (platform === 'darwin') {
    try {
      const result = await insertTextAtFocusedInput(text)
      if (result.ok && result.method) {
        return { delivered: true, method: result.method, fallbackReason: null, receiptMs: result.receiptMs }
      }
      if (result.reason === PASTE_NOT_CONSUMED_REASON) {
        return { delivered: false, method: null, reason: PASTE_NOT_CONSUMED_REASON, receiptMs: null }
      }
      fallbackReason = result.reason ?? 'native-insert-failed'
    }
    catch (error) {
      fallbackReason = error instanceof Error
        ? error.message
        : String(error)
    }
  }
  else {
    fallbackReason = `platform:${platform}`
  }

  await pasteText(text)
  return { delivered: true, method: 'clipboard', fallbackReason, receiptMs: null }
}

/** ax / paste 见 InsertTextMethod；clipboard 是最后的兜底 pasteText，会把文本留在用户剪贴板 */
export type ExternalTextInjectMethod = 'ax' | 'paste' | 'clipboard'

export type InjectTextToExternalInputOptions = {
  /**
   * 运行平台，测试注入用
   * @default process.platform
   */
  platform?: NodeJS.Platform
}

export type ExternalTextInjectOutcome =
  | {
    delivered: true
    /** 最终生效的投递路径 */
    method: ExternalTextInjectMethod
    /** 走到裸粘贴的原因；原生路径成功时为 null */
    fallbackReason: string | null
    /** 粘贴路径从 Cmd+V 到目标读剪贴板的毫秒数；其它路径为 null */
    receiptMs: number | null
  }
  | {
    delivered: false
    method: null
    /** 没送达的原因；目前只有「粘贴后预算内没人读剪贴板」这一种 */
    reason: typeof PASTE_NOT_CONSUMED_REASON
    receiptMs: null
  }
