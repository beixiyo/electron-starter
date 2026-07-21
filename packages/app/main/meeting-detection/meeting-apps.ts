import { createStore } from '@main/store'

export type MeetingAppDefinition = {
  id: string
  displayName: string
  bundleIds: string[]
}

/** 已知会议应用，匹配后显示友好名称 */
export const KNOWN_APPS: MeetingAppDefinition[] = [
  {
    id: 'zoom',
    displayName: 'Zoom',
    bundleIds: ['us.zoom.xos'],
  },
  {
    id: 'teams',
    displayName: 'Microsoft Teams',
    bundleIds: ['com.microsoft.teams', 'com.microsoft.teams2'],
  },
  {
    id: 'slack',
    displayName: 'Slack',
    bundleIds: ['com.tinyspeck.slackmacgap'],
  },
  {
    id: 'line',
    displayName: 'LINE',
    bundleIds: ['jp.naver.line.mac'],
  },
  {
    id: 'lark',
    displayName: '飞书会议',
    bundleIds: ['com.electron.lark'],
  },
]

/**
 * 匹配已知会议应用，返回友好名称
 * 未匹配时返回 null，调用方应使用进程名作为 fallback
 */
export function matchApp(bundleId: string): MeetingAppDefinition | null {
  for (const app of KNOWN_APPS) {
    if (app.bundleIds.some(id => bundleId.startsWith(id))) {
      return app
    }
  }
  return null
}

/**
 * 忽略名单：听写 / 语音输入法等工具，触发热键时会瞬间同时占用麦克风输入与音频输出（提示音），
 * 会被会议检测误判为会议。这类应用永远不应算作会议，在检测入口直接跳过
 */
export const IGNORED_BUNDLE_IDS: string[] = [
  'now.typeless.desktop', // Typeless（听写工具），按 fn 听写时误触发
]

/**
 * 进程名兜底名单：小写子串匹配，只用于原生层拿不到 bundle id 的进程（裸可执行文件 / 命令行工具）
 * 故意留空——Electron helper 子进程的 bundle id 已由 audio-monitor 从 `.app` 路径回溯补齐，
 * 走上面的前缀匹配即可；子串匹配远比前缀匹配容易误伤，不设内置条目，
 * 需要临时排查时经 `~/.electron-app/meeting-detection-ignore.json` 的 processNames 补
 */
export const IGNORED_PROCESS_NAME_KEYWORDS: string[] = []

/**
 * 用户自定义忽略名单（`~/.electron-app/meeting-detection-ignore.json`），启动时读一次并并入内置名单
 * 无 UI 入口，纯粹给调试 / 自测用：撞到新的听写工具时改 JSON 重启即可，不必改代码重新打包
 * 只做扩展不做覆盖——内置名单永远生效，避免误删配置导致已知误判回归
 */
const ignoreOverridesStore = createStore<IgnoreOverrides>('meeting-detection-ignore.json', {
  bundleIds: [],
  processNames: [],
})

let ignoreOverrides: IgnoreOverrides = { bundleIds: [], processNames: [] }

/** 只保留字符串项，脏数据（数字 / null / 嵌套）不应让整份配置失效 */
function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : []
}

/**
 * 启动时加载用户忽略名单，由 startMeetingDetector 调用（读文件是副作用，不放模块顶层）
 */
export function loadIgnoreOverrides(): void {
  const raw = ignoreOverridesStore.read()

  ignoreOverrides = {
    bundleIds: normalizeList(raw.bundleIds),
    processNames: normalizeList(raw.processNames).map(name => name.toLowerCase()),
  }

  if (ignoreOverrides.bundleIds.length || ignoreOverrides.processNames.length) {
    console.log('[meeting-detection] user ignore list loaded:', ignoreOverrides)
  }
}

/**
 * 输入法进程目录：macOS 只认这三处安装位置——`/Library`、`~/Library`、`/System/Library`，
 * 三者都以 `/Library/Input Methods/` 结尾，一条子串即可全覆盖。
 *
 * 路径本身就是「这是输入法」的结构性证据。输入法永远不是会议应用，但语音输入
 * （微信 / 豆包 / 搜狗等自带）会同时占麦克风与提示音输出，被会议检测误判。
 * 按目录一刀切排除比逐个枚举包名可靠——用户新装的输入法自动覆盖，无需改代码
 */
const INPUT_METHOD_DIR = '/Library/Input Methods/'

function isInputMethodProcess(executablePath: string): boolean {
  return executablePath.includes(INPUT_METHOD_DIR)
}

/**
 * 是否为应忽略的应用（输入法 / 听写 / 语音输入工具等）
 *
 * 判据优先级：输入法安装目录 > bundleId 前缀 > 进程名子串（仅用户名单，见上）
 */
export function isIgnoredApp(bundleId: string, processName: string, executablePath: string): boolean {
  if (isInputMethodProcess(executablePath))
    return true

  if (bundleId && [...IGNORED_BUNDLE_IDS, ...ignoreOverrides.bundleIds].some(id => bundleId.startsWith(id)))
    return true

  const name = processName.toLowerCase()
  if (!name)
    return false

  return [...IGNORED_PROCESS_NAME_KEYWORDS, ...ignoreOverrides.processNames].some(keyword => name.includes(keyword))
}

type IgnoreOverrides = {
  /** 前缀匹配的 bundle id，如 `now.typeless.desktop` */
  bundleIds: string[]
  /** 小写子串匹配的进程名关键字，用于原生层拿不到 bundleId 的 helper 子进程 */
  processNames: string[]
}
