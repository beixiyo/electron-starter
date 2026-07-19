import type { NativeNotifyEvent } from '@ipc/services/notification/contract'
import type {
  NotifyAction,
  NotifyEventCtx,
  NotifyHandle,
  NotifyOptions,
  NotifyReply,
  NotifyTimeoutType,
  NotifyUrgency,
} from './types'

/**
 * Electron 适配器
 *
 * 回调留在渲染进程：以 `id` 关联，主进程仅回传可序列化的事件，
 * 这里维护 `id → 注册项` 表并按 id 路由到对应回调。
 *
 * 运行时根据当前系统（`$electron.process.platform`）只取 `mac` / `windows` / `linux`
 * 三者之一，扁平化成与平台无关的内部结构后再发给主进程。
 */

/** 用强随机 id，避免多窗口（各自独立 realm）生成相同自增 id 而互相干扰 */
function nextId(): string {
  return `notify_${crypto.randomUUID()}`
}

/** 解析后的当前系统桌面配置（平台无关的内部结构） */
interface ResolvedDesktop {
  subtitle?: string
  sound?: string
  closeButtonText?: string
  urgency?: NotifyUrgency
  timeoutType?: NotifyTimeoutType
  actions?: NotifyAction[]
  reply?: NotifyReply
  onAction?: (index: number, ctx: NotifyEventCtx) => void
  onReply?: (text: string, ctx: NotifyEventCtx) => void
}

/** 按当前系统取对应平台配置，其余忽略 */
function resolveDesktop(options: NotifyOptions): ResolvedDesktop {
  switch (window.$electron?.process?.platform) {
    case 'darwin':
      return options.mac ?? {}
    case 'win32':
      return options.windows ?? {}
    case 'linux':
      return options.linux ?? {}
    default:
      return {}
  }
}

interface RegistryEntry {
  options: NotifyOptions
  desktop: ResolvedDesktop
  /** 注册时间戳，供陈旧条目清扫（原生 close 事件不保证回传） */
  createdAt: number
}

/** id → 注册项（含回调），收到对应事件时查表回调 */
const registry = new Map<string, RegistryEntry>()

/** 超过该时长仍未清理的条目视为陈旧，下次 show 时顺手清扫（不引入常驻定时器） */
const STALE_ENTRY_MS = 24 * 60 * 60 * 1000

/** 清扫陈旧条目：macOS 点击/顶替后 'close' 不保证回传，注册项及其闭包会永久滞留，靠此兜底 */
function sweepStaleEntries(): void {
  const now = Date.now()
  for (const [id, entry] of registry) {
    if (now - entry.createdAt > STALE_ENTRY_MS)
      registry.delete(id)
  }
}

/** 全局只订阅一次主进程事件 */
let subscribed = false

function ensureSubscribed(): void {
  if (subscribed)
    return
  subscribed = true

  $ipc.notification.on('event', (e: NativeNotifyEvent) => {
    const entry = registry.get(e.id)
    if (!entry)
      return

    const { options, desktop } = entry
    const ctx: NotifyEventCtx = { tag: options.tag, data: options.data }

    switch (e.type) {
      case 'show':
        options.onShow?.(ctx)
        break
      case 'click':
        options.onClick?.(ctx)
        /**
         * macOS 点击即消失但不保证回发 'close'，点击后条目不再有后续事件，直接删除防闭包累积；
         * 声明了 actions/reply 的条目例外：'action'/'reply' 事件可能在 click 之外单独到达，
         * 保留注册项等 close/失败/陈旧清扫兜底
         */
        if (!desktop.actions?.length && desktop.reply == null)
          registry.delete(e.id)
        break
      case 'action':
        desktop.onAction?.(e.actionIndex ?? -1, ctx)
        break
      case 'reply':
        desktop.onReply?.(e.reply ?? '', ctx)
        break
      case 'failed':
        options.onError?.(ctx)
        registry.delete(e.id)
        break
      case 'close':
        options.onClose?.(ctx)
        registry.delete(e.id)
        break
    }
  })
}

export function electronNotify(options: NotifyOptions): NotifyHandle {
  ensureSubscribed()

  sweepStaleEntries()

  const id = nextId()
  const desktop = resolveDesktop(options)
  registry.set(id, { options, desktop, createdAt: Date.now() })

  $ipc.notification.show({
    id,
    title: options.title,
    body: options.body,
    icon: options.icon,
    silent: options.silent,
    tag: options.tag,
    requireInteraction: options.requireInteraction,

    subtitle: desktop.subtitle,
    urgency: desktop.urgency,
    timeoutType: desktop.timeoutType,
    sound: desktop.sound,
    closeButtonText: desktop.closeButtonText,
    hasReply: desktop.reply != null,
    replyPlaceholder: desktop.reply?.placeholder,
    actions: desktop.actions,
  }).catch(() => {
    /** 主进程创建/展示失败：回调 onError 并清理，与 web 适配器行为对齐 */
    options.onError?.({ tag: options.tag, data: options.data })
    registry.delete(id)
  })

  return {
    close: () => {
      const entry = registry.get(id)
      $ipc.notification.close(id)
      /**
       * 主动关闭立即触发 onClose（与 Web 端一致）：原生 'close' 事件不保证回传，
       * 这里同步回调并删除注册项；若稍后原生事件确实到达，registry 已无该 id 自然去重
       */
      if (entry) {
        registry.delete(id)
        entry.options.onClose?.({ tag: entry.options.tag, data: entry.options.data })
      }
    },
  }
}

export function electronNotifySupported(): Promise<boolean> {
  return $ipc.notification.isSupported()
}
