/** 外部 App 输入框的文本投递策略：macOS 优先原生直插，失败或非 macOS 回退到剪贴板粘贴 */

import { insertTextAtFocusedInput } from './insert-text'
import { pasteText } from './utils'

/**
 * 把文本投进前台外部 App 的焦点输入框
 *
 * 直接调 pasteText 会把转写文本留在用户剪贴板里、覆盖用户原先复制的内容。macOS 上由
 * `insert-text` 辅助程序先试辅助功能直写，不行再做「快照 → 粘贴 → 写回」，用户剪贴板前后不变；
 * 只有原生路径不可用（辅助程序缺失、两条路径都失败）或非 macOS 时才回到裸粘贴，
 * 保证文本永远送达、不因新路径的兼容性问题丢掉整段输入
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
        return { method: result.method, fallbackReason: null }
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
  return { method: 'clipboard', fallbackReason }
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

export type ExternalTextInjectOutcome = {
  /** 最终生效的投递路径 */
  method: ExternalTextInjectMethod
  /** 走到剪贴板粘贴的原因；原生直插成功时为 null */
  fallbackReason: string | null
}
