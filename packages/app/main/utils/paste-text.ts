import { Key, keyboard } from '@nut-tree-fork/nut-js'
import { clipboard as electronClipboard } from 'electron'

/**
 * 粘贴文本到当前焦点位置
 * @param text 要粘贴的文本
 */
export async function pasteText(text: string): Promise<void> {
  try {
    electronClipboard.writeText(text)
  }
  catch (error) {
    console.error('[pasteText] 写入剪贴板失败', error)
    return
  }

  const ctrlKey = process.platform === 'darwin'
    ? Key.LeftSuper
    : Key.LeftControl

  try {
    /** 模拟 Ctrl+V 快捷键进行粘贴 */
    await keyboard.pressKey(ctrlKey)
    await keyboard.pressKey(Key.V)
    await keyboard.releaseKey(Key.V)
    await keyboard.releaseKey(ctrlKey)
  }
  catch (error) {
    console.error('[pasteText] 模拟粘贴快捷键失败', error)
  }
}
