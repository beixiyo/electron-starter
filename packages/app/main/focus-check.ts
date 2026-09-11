import { execFile } from 'node:child_process'
import { getNativeBinaryPath } from './native-bridge'

export function checkFocusedTextInput(): Promise<FocusCheckResult> {
  if (process.platform !== 'darwin')
    throw new Error('[focus-check] macOS only')

  return new Promise((resolve) => {
    execFile(getNativeBinaryPath('focus-check'), [], { timeout: 500 }, (error, stdout) => {
      if (error) {
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
        resolve({ focused: false, role: null, app: null, bundleId: null, pid: -1 })
      }
    })
  })
}

export type FocusCheckResult = {
  /**
   * 是否有可落点的目标，恒等于 helper 的 `tier != 'none'`
   *
   * 包含两种情况：AX 拿到可写焦点元素（直插可用），或 AX 看不见焦点元素但有焦点窗口
   * 且菜单栏挂着标准 Cmd+V（只能粘贴）。所以有焦点窗口的 Finder / 无文本焦点的 Safari
   * 也会是 `true`，不等同于「光标正停在输入框里」
   */
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
