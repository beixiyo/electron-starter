/** 全局提示窗口的拉取、显示、收起与测量通道 */

import { createIpcService } from '@ipc/core'
import { applyGlobalToastMeasurement, getCurrentGlobalToast, hideGlobalToast, showGlobalToast } from '@main/global-toast'
import type { GlobalToastContract } from './contract'
import { GLOBAL_TOAST_NAMESPACE } from './contract'

createIpcService<GlobalToastContract>(GLOBAL_TOAST_NAMESPACE, {
  mainHandle: {
    async getCurrent() {
      return getCurrentGlobalToast()
    },
  },
  mainOn: {
    show(_event, options) {
      showGlobalToast(options)
    },
    dismiss() {
      hideGlobalToast()
    },
    measured(_event, { token, width, height }) {
      applyGlobalToastMeasurement(token, width, height)
    },
  },
})
