import { execFile } from 'node:child_process'
import { getNativeBinaryPath } from './native-bridge'

/** 辅助程序不可用时的兜底：不把不确定的焦点当成可投递目标 */
const UNKNOWN_FOCUS: FocusCheckResult = {
  focused: false,
  tier: 'none',
  role: null,
  app: null,
  bundleId: null,
  pid: -1,
  pasteMenuEnabled: null,
}

function parseFocusTier(value: unknown): FocusTier {
  return value === 'editable' || value === 'pasteable'
    ? value
    : 'none'
}

export function checkFocusedTextInput(): Promise<FocusCheckResult> {
  if (process.platform !== 'darwin')
    throw new Error('[focus-check] macOS only')

  return new Promise((resolve) => {
    execFile(getNativeBinaryPath('focus-check'), [], { timeout: 500 }, (error, stdout) => {
      if (error) {
        console.warn('[focus-check] failed:', error.message)
        resolve(UNKNOWN_FOCUS)
        return
      }

      try {
        const result = JSON.parse(stdout.trim())
        const tier = parseFocusTier(result.tier)
        resolve({
          focused: tier !== 'none',
          tier,
          role: result.role ?? null,
          app: result.app ?? null,
          bundleId: result.bundleId ?? null,
          pid: Number(result.pid) || -1,
          pasteMenuEnabled: typeof result.pasteMenuEnabled === 'boolean'
            ? result.pasteMenuEnabled
            : null,
        })
      }
      catch {
        console.warn('[focus-check] parse error:', stdout)
        resolve(UNKNOWN_FOCUS)
      }
    })
  })
}

export type FocusCheckResult = {
  /**
   * 是否有可落点的目标，恒等于 helper 的 `tier != 'none'`
   *
   * 包含两种情况：AX 拿到可写焦点元素（直插可用），或 AX 看不见焦点元素但有焦点窗口
   * 且菜单栏挂着标准 Cmd+V（只能粘贴）。所以无文本焦点的 Safari 也可能是 `true`，
   * 不等同于「光标正停在输入框里」；焦点明确落在列表 / 按钮上或前台是访达时恒为 `false`
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
  /** AX 判定档位；`none` 表示没有可靠的外部投递目标 */
  tier: FocusTier
  /** 标准粘贴菜单项是否存在且当前启用；仅供诊断，判定只看是否存在 */
  pasteMenuEnabled: boolean | null
}

/**
 * 外部焦点的投递能力档位
 *
 * - `editable`：AX 拿到可写焦点元素，直插与粘贴都能走
 * - `pasteable`：AX 看不见焦点元素（或只报出 AXWindow / AXGroup 这类藏得住光标的容器），
 *   但有焦点窗口且菜单栏挂着标准 Cmd+V，只能走粘贴
 * - `none`：没有落点。AX 明确报出焦点在列表 / 表格 / 按钮这类控件上也算这档——
 *   访达桌面就是 `AXList`，若判成 pasteable 会把文本 Cmd+V 进桌面丢掉
 */
export type FocusTier = 'editable' | 'pasteable' | 'none'
