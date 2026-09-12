/** 登录失效的并发与节流闸门；提示、账号清理和路由策略由启动入口注入。 */
import { throttle } from '@jl-org/tool'
import { createRendererFeatureLogger } from '@/logging'

const log = createRendererFeatureLogger('auth')
const UNAUTHORIZED_THROTTLE_MS = 3000
let handler: UnauthorizedHandler | null = null
let handling = false

/** 禁用尾随补跑，避免一轮失败结束后又自动弹出第二次登录失效提示。 */
const runThrottled = throttle(async (current: UnauthorizedHandler) => {
  handling = true
  try {
    await current()
  }
  catch (error) {
    log.error('unauthorized.failed', 'authentication cleanup failed', error)
    throw error
  }
  finally {
    handling = false
  }
}, UNAUTHORIZED_THROTTLE_MS, { makeSureNotToMissTask: false })

/** 注册处理策略；返回的清理函数只移除本次注册，不影响后续替换者。 */
export function registerUnauthorizedHandler(next: UnauthorizedHandler): () => void {
  handler = next
  return () => {
    if (handler === next)
      handler = null
  }
}

/** 执行一次登录失效处理；执行中和三秒内重复调用直接结束，不排队或补跑。 */
export async function runUnauthorizedHandler(): Promise<void> {
  if (handling)
    return
  if (!handler) {
    log.error('unauthorized.no-handler', 'authentication cleanup has not been registered')
    return
  }
  await runThrottled(handler)
}

/** 启动层注入的登录失效策略。 */
export type UnauthorizedHandler = () => void | Promise<void>
