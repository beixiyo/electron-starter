/** 语音输入宿主测试页：用两个独立文本框验证宿主注册、采集和结果回填。 */
import { transcribeDemoAudio } from '@/demo/voiceTranscription'
import { Mic2, Sparkles } from 'lucide-react'
import { VoiceInputTestHost } from './VoiceInputTestHost'

export default function VoiceInputTestPage() {
  return (
    <div className="h-full overflow-y-auto px-5 py-6 md:px-8 md:py-8 lg:px-13 lg:py-10">
      <div className="mx-auto max-w-220 space-y-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-text2">
            <Mic2 size={ 17 } aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-[0.16em]">Voice input</span>
          </div>
          <h1 className="text-[22px] font-medium leading-8 text-text">语音输入宿主测试</h1>
          <p className="max-w-160 text-sm leading-6 text-text3">
            两个输入框分别登记为独立宿主，转写结果按当前焦点和宿主状态投递到一个输入框。
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <VoiceInputTestHost
            hostId="voice-input-test-primary"
            label="文本输入 A"
            placeholder="在这里输入或接收转写结果"
            transcribe={ transcribeDemoAudio }
          />
          <VoiceInputTestHost
            hostId="voice-input-test-secondary"
            label="文本输入 B"
            placeholder="第二个宿主的文本内容"
            transcribe={ transcribeDemoAudio }
          />
        </div>

        <div className="flex items-start gap-3 rounded-2xl bg-background2 px-5 py-4 text-sm leading-6 text-text3">
          <Sparkles className="mt-0.5 shrink-0 text-text2" size={ 16 } aria-hidden="true" />
          <p>示例转写只用于检查界面和宿主隔离，实际项目可替换为自己的转写适配器。</p>
        </div>
      </div>
    </div>
  )
}
