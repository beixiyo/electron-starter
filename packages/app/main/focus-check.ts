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
