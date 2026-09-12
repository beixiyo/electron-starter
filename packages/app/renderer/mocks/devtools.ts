import { getMockRuntimeStatus } from './browser'
import { getMockConfig, resetMockConfig, setMockConfig, setMockEndpointScenario } from './config'

const DEBUG_HANDLE_KEY = '__appMockRuntime'

/** DEV 调试句柄；只暴露通用配置操作，不携带任何业务场景。 */
export function installMockDevtools(): () => void {
  if (typeof window === 'undefined') return () => {}

  const target = window as Window & { [DEBUG_HANDLE_KEY]?: unknown }
  const previous = target[DEBUG_HANDLE_KEY]
  const handle = {
    getConfig: getMockConfig,
    getStatus: getMockRuntimeStatus,
    setConfig: setMockConfig,
    setEndpointScenario: setMockEndpointScenario,
    reset: resetMockConfig,
  }
  target[DEBUG_HANDLE_KEY] = handle

  return () => {
    if (target[DEBUG_HANDLE_KEY] === handle) {
      if (previous === undefined) delete target[DEBUG_HANDLE_KEY]
      else target[DEBUG_HANDLE_KEY] = previous
    }
  }
}
