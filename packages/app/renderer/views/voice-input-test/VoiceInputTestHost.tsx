/** 单个文本输入宿主：每个宿主拥有独立采集器和会话。 */
import { createMediaRecorderCapture, useEmbeddedVoiceSession, VoiceInputActions, VoiceInputHost } from '@/components/voiceInput'
import { VoiceSessionNotice } from '@/components/voiceInput/VoiceSessionNotice'
import { isElectron } from '@/utils/env'
import { Button, Input } from 'comps'
import { Keyboard, Mic, RotateCcw } from 'lucide-react'
import { memo, useMemo, useState } from 'react'

export const VoiceInputTestHost = memo<VoiceInputTestHostProps>((props) => {
  const { hostId, label, placeholder } = props
  const [value, setValue] = useState('')
  const capture = useMemo(() => createMediaRecorderCapture(), [])
  const desktopAvailable = isElectron()
  const session = useEmbeddedVoiceSession({
    host: hostId,
    capture,
    transcribe: props.transcribe,
    onTranscription: setValue,
  })
  const busy = session.phase === 'recording' || session.phase === 'processing'

  const clear = () => {
    session.reset()
    setValue('')
  }

  return (
    <VoiceInputHost hostId={ hostId } className="rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-background3 text-text2">
            <Keyboard size={ 17 } aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-text">{ label }</h2>
            <p className="mt-1 text-xs leading-5 text-text3">输入内容会保留在当前宿主</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-background3 px-2.5 py-1 text-xs text-text3">
          { session.phase === 'idle'
            ? '就绪'
            : phaseLabel(session.phase) }
        </span>
      </div>

      <div className="mt-5">
        <Input
          value={ value }
          onChange={ setValue }
          placeholder={ placeholder }
          aria-label={ label }
          disabled={ busy }
        />
      </div>

      { (session.phase === 'recording' || session.phase === 'processing') && (
        <div className="mt-4 rounded-xl bg-background3 p-3">
          <VoiceInputActions
            phase={ session.phase }
            onCancel={ session.cancel }
            onStop={ session.stop }
            recordingLabel="正在采集"
            processingLabel="正在处理"
          />
        </div>
      ) }

      { session.phase === 'failure' && session.error && (
        <p role="alert" className="mt-3 text-sm leading-5 text-red-500">{ session.error }</p>
      ) }

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-text3">
          { desktopAvailable
            ? '按住桌面快捷键或点击开始'
            : '当前 Web 环境仅用于查看布局，桌面端才可启动' }
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" leftIcon={ <RotateCcw size={ 14 } /> } disabled={ !value && session.phase === 'idle' } onClick={ clear }>
            清空
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={ <Mic size={ 14 } /> }
            disabled={ !desktopAvailable || busy }
            onClick={ session.requestStart }
          >
            开始采集
          </Button>
        </div>
      </div>

      { value && (
        <div className="mt-4 rounded-xl bg-background3 px-4 py-3">
          <p className="mb-1 text-xs text-text3">最近结果</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text">{ value }</p>
        </div>
      ) }

      <VoiceSessionNotice session={ session } />
    </VoiceInputHost>
  )
})

VoiceInputTestHost.displayName = 'VoiceInputTestHost'

function phaseLabel(phase: ReturnType<typeof useEmbeddedVoiceSession>['phase']): string {
  if (phase === 'recording') return '采集中'
  if (phase === 'processing') return '处理中'
  if (phase === 'failure') return '失败'
  if (phase === 'canceled') return '已取消'
  if (phase === 'result') return '已完成'
  return '就绪'
}

type VoiceInputTestHostProps = {
  hostId: string
  label: string
  placeholder: string
  transcribe: Parameters<typeof useEmbeddedVoiceSession>[0]['transcribe']
}
