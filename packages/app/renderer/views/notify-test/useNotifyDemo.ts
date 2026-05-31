import type { NotifyHandle } from '@/utils/notify'
import { useLatestCallback } from 'hooks'
import { useRef, useState } from 'react'
import { isElectron } from '@/utils/env'
import { isNotifySupported, notify, requestNotifyPermission } from '@/utils/notify'

/**
 * 通知测试页逻辑封装
 *
 * 提供各场景的发送动作 + 实时事件日志，UI 层只负责渲染
 */
export function useNotifyDemo() {
  const [logs, setLogs] = useState<NotifyLog[]>([])
  const [permission, setPermission] = useState(readPermission())
  const [supported, setSupported] = useState<boolean | null>(null)

  /** 最近一条通知句柄，用于「关闭最近」 */
  const lastHandle = useRef<NotifyHandle | null>(null)
  const seq = useRef(0)

  const push = useLatestCallback((kind: NotifyLog['kind'], type: string, detail?: string) => {
    seq.current += 1
    const entry: NotifyLog = {
      id: seq.current,
      time: new Date().toLocaleTimeString(),
      kind,
      type,
      detail,
    }
    setLogs(prev => [entry, ...prev].slice(0, 50))
  })

  /** 基础通知：标题 + 正文，挂全部通用回调 */
  const sendBasic = useLatestCallback(() => {
    lastHandle.current = notify({
      title: '基础通知',
      body: '这是一条最基础的跨平台通知',
      data: { kind: 'basic' },
      onShow: () => push('event', 'onShow'),
      onClick: ctx => push('event', 'onClick', `data=${JSON.stringify(ctx.data)}`),
      onClose: () => push('event', 'onClose'),
      onError: () => push('error', 'onError', '无权限或创建失败'),
    })
    push('send', '基础通知')
  })

  /** 带操作按钮（仅 macOS / Windows） */
  const sendActions = useLatestCallback(() => {
    lastHandle.current = notify({
      title: '带操作按钮',
      body: '点击下方按钮（仅 macOS / Windows 显示）',
      onClick: () => push('event', 'onClick'),
      onClose: () => push('event', 'onClose'),
      onError: () => push('error', 'onError'),
      mac: {
        actions: [{ text: '同意' }, { text: '拒绝' }],
        onAction: index => push('event', 'onAction', `index=${index}`),
      },
      windows: {
        actions: [{ text: '同意' }, { text: '拒绝' }],
        onAction: index => push('event', 'onAction', `index=${index}`),
      },
    })
    push('send', '带按钮（桌面端）')
  })

  /** 带内联回复（仅 macOS / Windows） */
  const sendReply = useLatestCallback(() => {
    lastHandle.current = notify({
      title: '快速回复',
      body: '在通知里直接输入回复（仅 macOS / Windows）',
      onError: () => push('error', 'onError'),
      mac: {
        reply: { placeholder: '输入回复…' },
        onReply: text => push('event', 'onReply', `text=${text}`),
      },
      windows: {
        reply: { placeholder: '输入回复…' },
        onReply: text => push('event', 'onReply', `text=${text}`),
      },
    })
    push('send', '带回复（桌面端）')
  })

  /** 常驻通知：不自动消失 */
  const sendSticky = useLatestCallback(() => {
    lastHandle.current = notify({
      title: '常驻通知',
      body: '不会自动消失，需手动关闭',
      requireInteraction: true,
      onClose: () => push('event', 'onClose'),
      onError: () => push('error', 'onError'),
    })
    push('send', '常驻通知（requireInteraction）')
  })

  /** 相同 tag 替换：连发两条，后者应替换前者 */
  const sendReplace = useLatestCallback(() => {
    notify({
      title: '消息 1',
      body: '先发这条',
      tag: 'replace-demo',
      onError: () => push('error', 'onError'),
    })
    push('send', 'tag=replace-demo → 消息 1')

    window.setTimeout(() => {
      lastHandle.current = notify({
        title: '消息 2',
        body: '1.2s 后发出，应替换掉消息 1',
        tag: 'replace-demo',
        onError: () => push('error', 'onError'),
      })
      push('send', 'tag=replace-demo → 消息 2（替换）')
    }, 1200)
  })

  /** 关闭最近一条 */
  const closeLast = useLatestCallback(() => {
    if (!lastHandle.current) {
      push('action', '关闭最近', '暂无可关闭的通知')
      return
    }
    lastHandle.current.close()
    push('action', '关闭最近一条')
  })

  /** 请求权限 */
  const askPermission = useLatestCallback(async () => {
    const ok = await requestNotifyPermission()
    setPermission(readPermission())
    push('action', '请求权限', ok
      ? '已授权'
      : '未授权')
  })

  /** 检测支持 */
  const checkSupport = useLatestCallback(async () => {
    const ok = await isNotifySupported()
    setSupported(ok)
    push('action', '检测支持', ok
      ? '支持'
      : '不支持')
  })

  const clearLogs = useLatestCallback(() => setLogs([]))

  const env: NotifyEnv = {
    runtime: isElectron()
      ? 'Electron'
      : 'Web',
    platform: readPlatform(),
    permission,
    supported,
  }

  return {
    logs,
    env,
    sendBasic,
    sendActions,
    sendReply,
    sendSticky,
    sendReplace,
    closeLast,
    askPermission,
    checkSupport,
    clearLogs,
  }
}

function readPermission(): string {
  if (isElectron())
    return 'granted（主进程默认）'
  if (typeof window !== 'undefined' && 'Notification' in window)
    return Notification.permission
  return 'unsupported'
}

function readPlatform(): string {
  if (isElectron())
    return window.$electron?.process?.platform ?? 'unknown'
  if (typeof navigator !== 'undefined')
    return navigator.platform || 'browser'
  return 'unknown'
}

/** 单条事件日志 */
export interface NotifyLog {
  id: number
  time: string
  /** 日志类别，决定徽标颜色 */
  kind: 'send' | 'event' | 'action' | 'error'
  /** 类型名，如 onClick / 基础通知 */
  type: string
  /** 附加细节 */
  detail?: string
}

/** 当前环境信息 */
export interface NotifyEnv {
  runtime: 'Electron' | 'Web'
  platform: string
  permission: string
  supported: boolean | null
}
