/** 跨进程远端开关传输；键由宿主声明，不依赖具体后端协议。 */
import type { IpcContract } from '@ipc/core'

/** 功能名到启用状态的快照。 */
export type FeatureFlagSnapshot = Record<string, boolean>

/** 主窗口同步、其他窗口只读的开关协议。 */
export type FeatureFlagContract = IpcContract<{
  mainHandle: {
    sync: (flags: FeatureFlagSnapshot) => { success: boolean }
    getState: () => FeatureFlagSnapshot
  }
}>
