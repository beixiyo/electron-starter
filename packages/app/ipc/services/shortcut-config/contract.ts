import type { IpcContract } from '@ipc/core'
import type { ShortcutBindings, ShortcutRecordEvent, ShortcutRuntimeCapabilities, ShortcutRuntimeEvent } from '@shared/shortcuts'

/** renderer 只声明 action 与相位；gesture / binding 均由主进程按当前配置重建 */
export type ShortcutTriggerRequest = Pick<ShortcutRuntimeEvent, 'id' | 'phase'>

export type ShortcutConfigContract = IpcContract<{
  mainHandle: {
    getBindings: () => ShortcutBindings
    /** 可配置能力，只按平台判断；设置页据此过滤默认绑定 */
    getCapabilities: () => ShortcutRuntimeCapabilities
    /** 当前运行时能力，含权限与 native backend 状态；渲染端据此认领降级到窗口内的绑定 */
    getRuntimeCapabilities: () => ShortcutRuntimeCapabilities
    setBindings: (bindings: ShortcutBindings) => void
    /** 录制快捷键前调用，阻止主进程响应 fn 事件 */
    pauseForRecord: () => void
    /** 录制结束后调用，恢复主进程响应 */
    resumeAfterRecord: () => void
    /** 渲染进程 DOM backend 捕获到窗口内快捷键后回传，由主进程执行业务动作 */
    trigger: (event: ShortcutTriggerRequest) => void
  }
  rendererOn: {
    /** 主进程检测到真实键盘 down/up，推送给录制中的渲染进程 */
    record: ShortcutRecordEvent
    /** 配置或权限变化导致 runtime 重算，渲染端据此重新认领窗口内绑定 */
    runtimeChanged: undefined
  }
}>
