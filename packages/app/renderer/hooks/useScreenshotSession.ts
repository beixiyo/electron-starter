import type { ScreenshotFallbackTarget, ScreenshotOkPayload, ScreenshotStartOptions } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef } from 'react'
import { isElectron } from '@/utils/env'

/**
 * 区域截图会话（申请制，仅 Electron 可用）
 *
 * 流程：`startCapture()` 向主进程申请会话并记下返回的 `captureId`（存 ref）→
 * 用户框选确认 → 主进程把 `ok` 事件 **定向** 发回发起方 webContents →
 * 本 hook 校验 `payload.captureId` 等于自己申请到的 id 才消费，消费/取消后清 ref
 *
 * 同窗口多个 feature 各持有自己的 captureId 天然隔离；共享组件在任意窗口渲染
 * 都安全（主进程定向投递 + captureId 校验双保险）。主进程同一时刻只保留一个
 * 活跃会话，新申请会作废旧会话（旧发起方收到定向 `cancel` 事件清理 ref）
 *
 * 全局快捷键发起的截图没有渲染端申请方，主进程按活跃功能裁决投递目标并在 payload
 * 上携带 `fallback` 角色；声明了对应 `fallbackRole` 且当前没有自有会话的消费者负责
 * 接收。**同一窗口同一角色只允许一个挂载实例**
 *
 * Web 环境下 `available` 为 false，不订阅也不触发，调用方据此隐藏截图按钮
 */
export function useScreenshotSession(
  onCaptured: (dataUrl: string) => void,
  options?: UseScreenshotSessionOptions,
) {
  const handleCaptured = useLatestCallback(onCaptured)
  const { fallbackRole, requester } = options ?? {}

  /** 当前持有的会话 id；null 表示没有进行中的截图申请 */
  const captureIdRef = useRef<string | null>(null)

  /** 是否该由本消费者处理这条完成事件 */
  const shouldConsume = useLatestCallback((payload: ScreenshotOkPayload | undefined): boolean => {
    if (!payload?.captureId)
      return false

    /** 自己申请的会话 */
    if (payload.captureId === captureIdRef.current)
      return true

    /** 全局快捷键会话：无人持有 captureId，由声明了对应兜底角色的消费者接收 */
    return captureIdRef.current === null
      && !!fallbackRole
      && payload.fallback === fallbackRole
  })

  useEffect(() => {
    if (!isElectron())
      return

    const offOk = $ipc.screenshot.on('ok', (payload) => {
      if (!shouldConsume(payload))
        return

      captureIdRef.current = null
      if (payload.base64)
        handleCaptured(composeBase64(payload.base64))
    })

    /** 用户取消 / 新会话作废旧会话：清掉本地持有的会话 id */
    const offCancel = $ipc.screenshot.on('cancel', (payload) => {
      if (payload?.captureId === captureIdRef.current)
        captureIdRef.current = null
    })

    return () => {
      offOk()
      offCancel()
    }
  }, [])

  const startCapture = useLatestCallback(async (startOptions?: Pick<ScreenshotStartOptions, 'hideWindows'>) => {
    if (!isElectron())
      return

    const { captureId } = await $ipc.screenshot.startCapture({
      ...startOptions,
      requester,
    })
    captureIdRef.current = captureId
  })

  return {
    /** 当前环境是否支持截图（仅 Electron） */
    available: isElectron(),
    /** 申请截图会话并唤起选区覆盖层 */
    startCapture,
  }
}

/** 主进程下发的是裸 base64，拼成可直接用于 <img src> 的 data URL */
function composeBase64(base64: string): string {
  if (base64.startsWith('http') || base64.startsWith('data:image'))
    return base64
  return `data:image/png;base64,${base64}`
}

export type UseScreenshotSessionOptions = {
  /**
   * 全局快捷键截图的兜底消费角色：主进程裁决的 `fallback` 与之匹配、
   * 且本消费者当前没有自有会话时才接收。同一窗口同一角色只允许一个挂载实例
   */
  fallbackRole?: ScreenshotFallbackTarget
  /**
   * 发起方调试标识，仅用于主进程日志，不参与路由
   */
  requester?: string
}
