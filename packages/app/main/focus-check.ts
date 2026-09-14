import { execFile } from 'node:child_process'
import { getNativeBinaryPath } from './native-bridge'

/** 辅助程序不可用时的兜底：不把不确定的焦点当成可投递目标 */
const UNKNOWN_FOCUS: FocusCheckResult = {
  focused: false,
  tier: 'none',
  reason: 'helper-unavailable',
  role: null,
  app: null,
  bundleId: null,
  pid: -1,
  webContent: false,
  focusWaitMs: 0,
  pasteMenuEnabled: null,
}

/**
 * helper 自身最多等焦点元素 600 ms（Chromium 冷启动窗口的尾巴，见 FocusCheck/main.swift 头部），
 * 再加菜单栏扫描与进程启动；太短会把正在等待的进程整个杀掉、连 app / pid 一起丢
 */
const FOCUS_CHECK_TIMEOUT_MS = 1_500

const NONE_REASONS: readonly FocusNoneReason[] = [
  'no-frontmost-app',
  'secure-input',
  'secure-field',
  'focus-unavailable',
  'web-not-editable',
  'no-caret-role',
  'excluded-app',
  'no-paste-menu',
  'no-focused-window',
  'helper-unavailable',
]

function parseFocusTier(value: unknown): FocusTier {
  return value === 'editable' || value === 'pasteable'
    ? value
    : 'none'
}

function parseNoneReason(value: unknown): FocusNoneReason | null {
  return NONE_REASONS.includes(value as FocusNoneReason)
    ? value as FocusNoneReason
    : null
}

export function checkFocusedTextInput(): Promise<FocusCheckResult> {
  if (process.platform !== 'darwin')
    throw new Error('[focus-check] macOS only')

  return new Promise((resolve) => {
    execFile(getNativeBinaryPath('focus-check'), [], { timeout: FOCUS_CHECK_TIMEOUT_MS }, (error, stdout) => {
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
          reason: tier === 'none'
            ? parseNoneReason(result.reason) ?? 'helper-unavailable'
            : null,
          role: result.role ?? null,
          app: result.app ?? null,
          bundleId: result.bundleId ?? null,
          pid: Number(result.pid) || -1,
          webContent: result.web === true,
          focusWaitMs: Number(result.waitMs) || 0,
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

/**
 * 在按下快捷键那一刻对前台 App 跑一次 focus-check，结果不参与决策，只为把它的 AX 树提前捂热
 *
 * 实测症状：VS Code / Chrome 刚启动后第一轮投递，光标明明在终端里，却被判成没有落点
 * 根因是 Chromium 首次被打开完整 AX 树后约 2 s 内 `kAXFocusedUIElementAttribute` 一律 noValue
 * （fresh VS Code 实测 2140 ms），树热了以后 37 ms 就能拿到。真正投递那一刻再去查，
 * 撞上这个窗口只能判 `none`（`focus-unavailable`）。而触发投递本身需要一小段准备时间，
 * 在按下那一刻先查一次，到真正投递时树多半已经热了，helper 里剩下的 600 ms 轮询只需兜短按的尾巴
 *
 * 预热只是触发建树，树建多久由目标 App 决定：带扩展、还在启动的真实 VS Code 实测预热后 3.3 s 仍拿不到，
 * 那一轮 helper 判 `none`，不盲粘
 *
 * 副作用：会给前台 App 写 `AXEnhancedUserInterface` / `AXManualAccessibility`（与正式判定同一套），
 * 所以只在自身应用不在前台时调用——调用方判断，这里不查窗口焦点
 * 失败静默：预热只是加速，不影响正式判定
 */
export function prewarmExternalFocusCheck(): Promise<FocusCheckResult> {
  if (process.platform !== 'darwin') return Promise.resolve(UNKNOWN_FOCUS)
  return checkFocusedTextInput()
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
  /** AX 判定档位；`none` 表示没有可靠的外部投递目标 */
  tier: FocusTier
  /** `tier === 'none'` 时的拒绝理由，其余为 null */
  reason: FocusNoneReason | null
  /** AX 角色（AXTextField / AXTextArea / AXWebArea / AXComboBox / ...） */
  role: string | null
  /** 前台应用名称（localizedName，受系统语言影响） */
  app: string | null
  /** 前台应用 Bundle ID（如 com.microsoft.VSCode） */
  bundleId: string | null
  /** 前台应用 PID，与 process.pid 对比可可靠判断是否为自身（开发/生产均适用） */
  pid: number
  /** 焦点元素是否是 Blink / WebKit 的 DOM 节点，决定 helper 走了哪套可写判定；仅供诊断 */
  webContent: boolean
  /**
   * helper 为等焦点元素出现实际花掉的毫秒数，仅供诊断
   *
   * 大于 0 说明这一轮撞上了 Chromium 冷启动窗口；排「光标明明在输入框里却被判成没有落点」时先看它
   */
  focusWaitMs: number
  /** 标准粘贴菜单项是否存在且当前启用；仅供诊断，判定只看是否存在 */
  pasteMenuEnabled: boolean | null
}

/**
 * 外部焦点的投递能力档位
 *
 * - `editable`：AX 拿到可写焦点元素，直插与粘贴都能走。Web 内容节点看 `AXEditableAncestor`（Chromium）
 *   或选区 / 值可写 + 有效行号（WebKit），不只看「选区可写」——Chromium 连滑块、复选框都报可写
 * - `pasteable`：焦点只报出 AXWindow / AXGroup 这类**原生**容器（自绘控件当第一响应者就长这样）或
 *   `aria-activedescendant` 指向的列表行，但有焦点窗口且菜单栏挂着标准 Cmd+V，只能走粘贴
 * - `none`：没有落点，理由见 {@link FocusNoneReason}
 *
 * AX 是外部投递唯一的闸门。曾试过换成 `insert-text` 的剪贴板读回执，实测 Chrome body、Safari 空白页、
 * 系统设置侧栏在 Cmd+V 后都会读剪贴板却不落字，回执只能反向用（没人读一定没粘）
 * 三档的判定细节与实测矩阵在 `native/mac/accessibility/Sources/FocusCheck/main.swift` 头部
 */
export type FocusTier = 'editable' | 'pasteable' | 'none'

/**
 * `none` 的拒绝理由
 *
 * - `secure-input`：系统级安全输入开着（`IsSecureEventInputEnabled`），密码框聚焦时 AppKit / Chromium / Safari 都会打开
 * - `secure-field`：AX 角色 / 子角色含 secure / password
 * - `focus-unavailable`：等满 600 ms 仍拿不到焦点元素——Chromium 冷启动窗口没被预热耗掉，或 App 关掉了无障碍
 * - `web-not-editable`：Web 内容节点报出非可编辑角色（Chrome body 的 `AXWebArea`、VS Code 非输入区的 `AXGroup`、
 *   滑块 / 复选框 / 下拉框 / 只读输入框）；Chromium 热态有光标必报可编辑角色，容器就是没有光标
 * - `no-caret-role`：原生控件角色明确没有插入点（桌面的 `AXList`、系统设置侧栏的 `AXOutline`、按钮 …）
 * - `excluded-app`：没有任何文本落点的 App（访达：Cmd+V 只认文件）
 * - `no-paste-menu`：菜单栏读不到、没扫完或确定没有标准 Cmd+V（Moonlight 一类）
 * - `no-focused-window`：原生容器焦点但 App 没有焦点窗口
 * - `no-frontmost-app` / `helper-unavailable`：查不到前台 App，或辅助程序缺失 / 超时 / 输出不可解析
 */
export type FocusNoneReason =
  | 'no-frontmost-app'
  | 'secure-input'
  | 'secure-field'
  | 'focus-unavailable'
  | 'web-not-editable'
  | 'no-caret-role'
  | 'excluded-app'
  | 'no-paste-menu'
  | 'no-focused-window'
  | 'helper-unavailable'
