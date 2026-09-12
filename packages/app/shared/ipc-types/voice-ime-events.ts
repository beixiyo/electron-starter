import type { VoiceRecorderStatus } from 'comps'

/** Voice IME 的主进程相位。 */
export type VoiceImePhase = 'idle' | 'recording' | 'processing'

/** 本轮采集使用的承载面。 */
export type VoiceImeSurface = 'floating' | 'embedded'

/** 快捷键或点击入口使用的交互方式。 */
export type VoiceImeMode = 'hold' | 'click'

/** 嵌入式宿主的调用方身份，由调用方登记，主进程不解释其内容。 */
export type VoiceImeHostId = string

/** 窗口级宿主使用固定身份，与普通输入宿主分开记账。 */
export type VoiceImeWindowHost = 'window'

/** 一轮会话冻结的宿主身份；浮层会话不带宿主。 */
export type VoiceImeSessionHost = VoiceImeHostId | VoiceImeWindowHost

/** renderer 上报的当前焦点上下文。 */
export type VoiceImeFocusContext = {
  /** 当前深层焦点是否可以接收文本。 */
  editable: boolean
  /** 当前焦点是否位于已登记的嵌入宿主内。 */
  embeddedHost?: VoiceImeHostId
}

/** 主进程广播的会话快照。 */
export type VoiceImeActiveState = {
  phase: VoiceImePhase
  /** 采集真正开始的时刻；非 recording 阶段为 null。 */
  recordingStartedAt: number | null
  /** 发起时冻结的承载面；没有活动会话时为 null。 */
  surface: VoiceImeSurface | null
  /** 当前会话身份；空闲时为 null。 */
  sessionId: string | null
}

/** 统一发起门禁返回的阻断原因。 */
export type VoiceImeStartBlocker =
  | 'recording'
  | 'session'
  | 'capture'
  | 'offline'
  | 'disk'
  | 'permission'
  | 'aborted'

/** 补投文本时可选的来源宿主。 */
export type VoiceImeDeliverPayload = {
  text: string
  sourceHost?: VoiceImeSessionHost
}

/** 宿主登记时可显式声明为当前窗口的默认投递宿主。 */
export type VoiceImeHostRegistrationOptions = {
  default?: boolean
}

/** 主进程要求嵌入宿主开始或结束采集。 */
export type VoiceImeEmbeddedCommandPayload = {
  host: VoiceImeSessionHost
  mode: VoiceImeMode
  sessionId: string
}

/** 浮层开始或结束采集的带身份指令。 */
export type VoiceImeFloatingCommandPayload = {
  mode: VoiceImeMode
  sessionId: string
}

/** 主进程把结果交给指定嵌入宿主。 */
export type VoiceImeEmbeddedTranscriptionPayload = {
  host: VoiceImeSessionHost
  text: string
  sessionId?: string
}

/** 主进程把结果交给浮层；sessionId 用于过滤跨轮迟到结果。 */
export type VoiceImeFloatingTranscriptionPayload = {
  text: string
  sessionId?: string
}

/** 嵌入宿主收到的通用阻断提示。 */
export type VoiceImeEmbeddedPromptPayload = {
  host: VoiceImeSessionHost
  code: VoiceImePromptCode
}

/** renderer 自行翻译的阻断语义码。 */
export type VoiceImePromptCode =
  | 'recordingBusy'
  | 'sessionBusy'
  | 'captureBlocked'
  | 'offline'
  | 'diskUnavailable'
  | 'permissionRequired'

/** 主进程请求 renderer 释放当前会话。 */
export type VoiceImeCancelPayload = {
  reason: VoiceImeCancelReason
  /** 迟到回调必须带回当时的会话身份；兼容旧电源事件时允许缺省。 */
  sessionId?: string | null
  host?: VoiceImeSessionHost
}

/** 取消会话的通用原因。 */
export type VoiceImeCancelReason =
  | 'escape'
  | 'user'
  | 'suspend'
  | 'resume'
  | 'lock-screen'
  | 'unlock-screen'
  | 'host-unavailable'
  | 'window-closed'

/** 浮层没有活动会话时收到 Escape 的关闭提示。 */
export type VoiceImeDismissPayload = {
  reason: 'escape'
  sessionId?: string | null
}

/** 兼容现有浮层录音面板的状态载荷。 */
export type VoiceImeRendererStatusPayload = {
  status?: VoiceRecorderStatus
  error?: string | null
  sessionId?: string | null
}
