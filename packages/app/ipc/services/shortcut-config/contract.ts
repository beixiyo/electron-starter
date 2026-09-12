/** 快捷键配置、录制会话与运行时事件的 IPC 契约 */
import type { IpcContract } from '@ipc/core'
import type { ShortcutBindings, ShortcutChord, ShortcutRecordEvent, ShortcutRuntimeCapabilities, ShortcutRuntimeEvent } from '@shared/shortcuts'

/** renderer 只声明 action 与相位；gesture / binding 均由主进程按当前配置重建 */
export type ShortcutTriggerRequest = Pick<ShortcutRuntimeEvent, 'id' | 'phase'>

/** 一次录制会话的捕获归属与校验依据 */
export type ShortcutRecordSession = {
  /** 主进程是否已接管系统级捕获；false 时渲染端用 DOM 自行产出录制事件 */
  nativeCapture: boolean
  /**
   * macOS 当前启用的系统快捷键，随本轮录制实时读取
   *
   * 跟着 `pauseForRecord` 一起下发而不是单独开一个接口：录制开始正是唯一需要它、
   * 也是唯一该重新读盘的时刻，分开取会多一次往返并让「实时」变成「上次」
   */
  systemShortcuts: ShortcutChord[]
}

export type ShortcutConfigContract = IpcContract<{
  mainHandle: {
    getBindings: () => ShortcutBindings
    /** 可配置能力，只按平台判断；设置页据此过滤默认绑定 */
    getCapabilities: () => ShortcutRuntimeCapabilities
    /** 当前运行时能力，含权限与 native backend 状态；渲染端据此认领降级到窗口内的绑定 */
    getRuntimeCapabilities: () => ShortcutRuntimeCapabilities
    setBindings: (bindings: ShortcutBindings) => void
    /** 录制快捷键前调用：暂停主进程 runtime，并尝试接管系统级捕获 */
    pauseForRecord: () => ShortcutRecordSession
    /** 录制结束后调用，恢复主进程响应 */
    resumeAfterRecord: () => void
    /** 渲染进程 DOM backend 捕获到窗口内快捷键后回传，由主进程执行业务动作 */
    trigger: (event: ShortcutTriggerRequest) => void
  }
  rendererOn: {
    /** 主进程捕获到的录制事件，Fn 组合与普通键盘来自同一条输入流 */
    record: ShortcutRecordEvent
    /** 捕获后端丢失物理状态（helper 重启等），渲染端应清空本轮录制 */
    recordReset: undefined
    /** 配置或权限变化导致 runtime 重算，渲染端据此重新认领窗口内绑定 */
    runtimeChanged: undefined
  }
}>
