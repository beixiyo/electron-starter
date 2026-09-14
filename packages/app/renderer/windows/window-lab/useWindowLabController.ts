/** Window Lab 控制器：连接本地场景、iframe 消息和可选原生预览。 */

import { useLatestCallback } from 'hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getWindowLabApi } from './ipc'
import { isWindowLabSizeMessage, serializeWindowLabPreview } from './preview'
import { getWindowLabTarget } from './targets'
import { getVoiceImeInitialSize } from './targets/voice-ime/scene'
import type { WindowLabBounds, WindowLabPreview, WindowLabSize } from './types'

export function useWindowLabController(initialPreview: WindowLabPreview): WindowLabController {
  const [preview, setPreview] = useState(initialPreview)
  const [frameSize, setFrameSize] = useState(() => getVoiceImeInitialSize(initialPreview))
  const [zoom, setZoom] = useState(1)
  const [nativeBounds, setNativeBounds] = useState<WindowLabBounds | null>(null)
  const [nativeOpen, setNativeOpen] = useState(false)
  const [notice, setNotice] = useState('Ready')
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const nativeOpenRef = useRef(false)
  const api = useMemo(() => getWindowLabApi(), [])
  const adapter = getWindowLabTarget(preview)
  const selectedPresetId = adapter.getPresetId(preview)
  const frameSrc = useMemo(() => `./frame.html?${serializeWindowLabPreview(initialPreview)}`, [initialPreview])

  const sendPreviewToFrame = useLatestCallback((nextPreview: WindowLabPreview) => {
    frameRef.current?.contentWindow?.postMessage({ type: 'window-lab:preview', preview: nextPreview }, window.location.origin)
  })

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      if (!isWindowLabSizeMessage(event.data)) return
      setFrameSize({ width: event.data.width, height: event.data.height })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    sendPreviewToFrame(preview)
  }, [preview, sendPreviewToFrame])

  useEffect(() => {
    if (!api?.on) return
    const removeBoundsListener = api.on('boundsChanged', (value) => {
      if (isBounds(value)) {
        setNativeBounds(value)
        setNativeOpen(true)
        nativeOpenRef.current = true
      }
      else {
        setNativeBounds(null)
        setNativeOpen(false)
        nativeOpenRef.current = false
      }
    })
    return removeBoundsListener
  }, [api])

  useEffect(() => {
    if (!api || !nativeOpenRef.current) return
    let active = true
    void Promise.resolve(api.openPreview(preview)).then((result) => {
      if (!active) return
      if (!result.success) setNotice(result.error ?? 'Native preview update failed')
      else if (result.bounds) setNativeBounds(result.bounds)
    }).catch((error: unknown) => {
      if (active) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Native preview update failed',
        )
      }
    })
    return () => {
      active = false
    }
  }, [api, preview])

  const updatePreview = useLatestCallback((nextPreview: WindowLabPreview) => {
    setPreview(nextPreview)
  })

  const selectPreset = useLatestCallback((presetId: string) => {
    const nextPreview = adapter.applyPreset(preview, presetId)
    setPreview(nextPreview)
    setFrameSize(adapter.getInitialSize(nextPreview))
    setNotice(`Scene: ${presetId}`)
  })

  const openNativePreview = useLatestCallback(async () => {
    if (!api) {
      setNotice('Native preview is unavailable in the browser')
      return
    }
    try {
      const result = await api.openPreview(preview)
      if (!result.success) {
        setNotice(result.error ?? 'Native preview failed')
        return
      }
      setNativeOpen(true)
      nativeOpenRef.current = true
      setNativeBounds(result.bounds ?? null)
      setNotice('Native preview open')
    }
    catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Native preview failed',
      )
    }
  })

  const closeNativePreview = useLatestCallback(async () => {
    if (!api) return
    try {
      const result = await api.closePreview()
      if (!result.success) {
        setNotice(result.error ?? 'Native preview close failed')
        return
      }
      setNativeOpen(false)
      nativeOpenRef.current = false
      setNativeBounds(null)
      setNotice('Native preview closed')
    }
    catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Native preview close failed',
      )
    }
  })

  const reset = useLatestCallback(() => {
    const nextPreview = adapter.defaultPreview
    setPreview(nextPreview)
    setFrameSize(adapter.getInitialSize(nextPreview))
    setZoom(1)
    setNotice('Reset to defaults')
  })

  const showUrl = useLatestCallback(() => {
    setNotice(`${window.location.origin}${window.location.pathname}?${serializeWindowLabPreview(preview)}`)
  })

  return {
    preview,
    adapter,
    selectedPresetId,
    frameRef,
    frameSrc,
    frameSize,
    zoom,
    nativeBounds,
    nativeOpen,
    nativeAvailable: api !== null,
    notice,
    updatePreview,
    selectPreset,
    setZoom,
    openNativePreview,
    closeNativePreview,
    reset,
    showUrl,
    sendCurrentPreviewToFrame: () => sendPreviewToFrame(preview),
  }
}

function isBounds(value: WindowLabBounds | WindowLabPreview | null): value is WindowLabBounds {
  return !!value
    && 'x' in value
    && 'y' in value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
}

export type WindowLabController = {
  preview: WindowLabPreview
  adapter: ReturnType<typeof getWindowLabTarget>
  selectedPresetId: string
  frameRef: React.RefObject<HTMLIFrameElement | null>
  frameSrc: string
  frameSize: WindowLabSize
  zoom: number
  nativeBounds: WindowLabBounds | null
  nativeOpen: boolean
  nativeAvailable: boolean
  notice: string
  updatePreview: (preview: WindowLabPreview) => void
  selectPreset: (presetId: string) => void
  setZoom: (zoom: number) => void
  openNativePreview: () => Promise<void>
  closeNativePreview: () => Promise<void>
  reset: () => void
  showUrl: () => void
  sendCurrentPreviewToFrame: () => void
}
