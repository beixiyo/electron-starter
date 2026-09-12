/** 窗口级宿主登记可写焦点，承接录音操作、撤销提示和无输入焦点时的结果。 */
import { useVoiceImeEscapeShield } from '@/hooks/useVoiceImeEscapeShield'
import { WINDOW_DATA_ATTR } from '@/windows/shared/dataAttributes'
import { isElectron } from '@/utils/env'
import { useLatestCallback } from 'hooks'
import { memo, useEffect, useMemo, useRef } from 'react'
import { cn } from 'utils'
import { createMediaRecorderCapture } from './mediaRecorderCapture'
import type { VoiceCaptureAdapter, VoiceTranscribeAdapter } from './types'
import { useGlobalToastNotice } from './useGlobalToastNotice'
import { useVoiceSession } from './useVoiceSession'
import { VoiceInputActions } from './VoiceInputActions'
import { VoiceSessionNotice } from './VoiceSessionNotice'

export const VoiceImeWindowHost = memo<VoiceImeWindowHostProps>((props) => {
  const { active = true, editable = true, capture: injectedCapture, transcribe, onTranscription, onPrompt, onError, children, className, ...rest } = props
  const elementRef = useRef<HTMLDivElement | null>(null)
  const capture = useMemo(() => injectedCapture ?? createMediaRecorderCapture(), [injectedCapture])
  const session = useVoiceSession({ host: 'window', active, capture, transcribe, onTranscription, onPrompt, onError })
  useGlobalToastNotice(active)
  useVoiceImeEscapeShield()

  const updateFocus = useLatestCallback(() => {
    if (!isElectron()) return
    let focused = document.activeElement
    while (focused instanceof HTMLElement && focused.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement
    const inside = Boolean(active && focused && elementRef.current?.contains(focused))
    const inputHost = inside
      ? focused?.closest<HTMLElement>(`[${WINDOW_DATA_ATTR.voiceInputHost}][${WINDOW_DATA_ATTR.voiceInputSurface}="embedded"]`)
      : null
    const embeddedHost = inputHost?.getAttribute(WINDOW_DATA_ATTR.voiceInputHost)
    void $ipc.voiceIme.setFocusContext({
      editable: inside && editable && isWritableElement(focused),
      ...(embeddedHost
        ? { embeddedHost }
        : {}),
    }).catch(onError)
  })
  useEffect(() => {
    window.addEventListener('focusin', updateFocus, true)
    window.addEventListener('focusout', updateFocus, true)
    updateFocus()
    return () => {
      window.removeEventListener('focusin', updateFocus, true)
      window.removeEventListener('focusout', updateFocus, true)
      if (isElectron()) void $ipc.voiceIme.setFocusContext({ editable: false }).catch(() => {})
    }
  }, [active, editable, updateFocus])

  return (
    <div { ...rest } ref={ elementRef } className={ cn('min-w-0', className) }>
      { children }
      <VoiceSessionNotice session={ session } />
      { (session.phase === 'recording' || session.phase === 'processing') && (
        <div className="fixed bottom-6 left-1/2 z-50 w-64 -translate-x-1/2 rounded-full bg-background p-2 shadow-lg">
          <VoiceInputActions phase={ session.phase } onCancel={ session.cancel } onStop={ session.stop } />
        </div>
      ) }
      { session.text && (
        <div role="status" className="fixed bottom-6 right-6 z-50 max-h-64 w-80 overflow-auto rounded-xl bg-background p-4 shadow-lg">
          <p className="whitespace-pre-wrap break-words text-sm">{ session.text }</p>
          <button type="button" className="mt-3 text-sm text-text3" onClick={ session.reset }>Dismiss</button>
        </div>
      ) }
    </div>
  )
})
VoiceImeWindowHost.displayName = 'VoiceImeWindowHost'

export type VoiceImeWindowHostProps = React.PropsWithChildren<Omit<React.HTMLAttributes<HTMLDivElement>, 'onError'>> & {
  /** @default true */
  active?: boolean
  /** @default true */
  editable?: boolean
  capture?: VoiceCaptureAdapter
  transcribe: VoiceTranscribeAdapter
  onTranscription?: (text: string) => void
  onPrompt?: (code: string) => void
  onError?: (error: Error) => void
}

function isWritableElement(element: Element | null): boolean {
  if (element instanceof HTMLInputElement)
    return ['text', 'search', 'url', 'tel', 'email'].includes(element.type) && !element.disabled && !element.readOnly
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  return element instanceof HTMLElement && element.isContentEditable
}
