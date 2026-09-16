import type { UpdateInfoLite, UpdateProgress, UpdateStatus } from '@ipc/services/update/contract'

/** 自动更新渲染状态和策略类型。 */
/** 内部状态机：IPC 契约状态额外加一个初始 `idle`。 */
export type UpdaterStatus = UpdateStatus | 'idle'

/** 自动弹窗的来源，用于区分会话节流与手动打开。 */
export type UpdaterPromptSource = 'auto-available' | 'auto-force' | 'manual'

/** 检查到新版本后由宿主注入的策略结果。 */
export interface UpdaterPolicy {
  /** 是否必须更新；未提供策略时默认为 false。 */
  forceUpdate?: boolean
  /** 可选的更新标题。 */
  title?: string
  /** 可选的更新说明。 */
  notes?: string
}

/** `checkPolicy` 收到的上下文。 */
export interface UpdaterPolicyContext {
  /** 当前安装版本；IPC 尚未返回时为空字符串。 */
  currentVersion: string
  /** 自动更新引擎确认可用的目标版本。 */
  info: UpdateInfoLite
}

/** `canPrompt` 收到的上下文。 */
export interface UpdaterPromptContext {
  /** 触发这次打开请求的来源。 */
  source: UpdaterPromptSource
  /** 当前可用版本；手动打开时可能为空。 */
  info: UpdateInfoLite | null
  /** 请求发生时是否已经命中强制更新。 */
  forceUpdate: boolean
}

/**
 * 更新状态仓的注入点
 *
 * 底层只负责状态机，不依赖登录、业务后端或其他产品服务。宿主可以注入弹窗资格和
 * 更新策略；两者都可以异步返回。没有注入策略时，强制更新默认为 false
 */
export interface UpdaterStoreOptions {
  /**
   * 判断当前会话是否允许展示更新弹窗
   * @default () => true
   */
  canPrompt?: (context: UpdaterPromptContext) => boolean | Promise<boolean>
  /**
   * 为一个可用版本提供通用更新策略
   * @default () => ({ forceUpdate: false })
   */
  checkPolicy?: (context: UpdaterPolicyContext) => UpdaterPolicy | null | undefined | Promise<UpdaterPolicy | null | undefined>
  /**
   * 普通自动弹窗两次实际展示之间的最小间隔（毫秒）
   * @default 86400000
   */
  autoPromptIntervalMs?: number
  /**
   * 后台发现普通更新时是否自动打开弹窗
   *
   * 关闭时仍会自动下载；用户打开更新页即可查看进度或安装
   * @default false
   */
  autoOpenOnAvailable?: boolean
}

export interface UpdaterState {
  /** 当前应用版本号。 */
  currentVersion: string
  /** 更新状态机。 */
  status: UpdaterStatus
  /** 可用 / 已下载更新的版本信息。 */
  info: UpdateInfoLite | null
  /** 下载进度（仅下载阶段非空）。 */
  progress: UpdateProgress | null
  /** 错误分类码（status 为 error 时）。 */
  error: string | null
  /** 更新弹窗是否打开。 */
  modalOpen: boolean
  /** 当前策略是否锁定为强制更新。 */
  forceUpdate: boolean
  /** 注入策略提供的标题。 */
  policyTitle: string
  /** 注入策略提供的说明。 */
  policyNotes: string
}
