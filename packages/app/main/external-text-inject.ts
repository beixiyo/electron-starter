/** 外部 App 输入框的文本投递策略：macOS 优先原生直插，失败或非 macOS 回退到剪贴板粘贴 */

import { insertTextAtFocusedInput } from './insert-text'
import { pasteText } from './utils'

/**
 * 把文本投进前台外部 App 的焦点输入框
 *
 * 剪贴板粘贴会把转写文本留在用户剪贴板里、覆盖用户原先复制的内容。macOS 上有辅助功能
 * 与键盘事件两条不碰剪贴板的路径（见 `insert-text` 辅助程序），所以先走它；
 * 只有原生路径不可用（辅助程序缺失、目标 App 两条路径都不吃）或非 macOS 时才回到粘贴，
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

export type ExternalTextInjectMethod = 'ax' | 'keyboard' | 'clipboard'

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
