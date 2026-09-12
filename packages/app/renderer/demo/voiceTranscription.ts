/** 模板的转写示例入口；接入真实服务时只替换此适配器，采集和投递链路保持不变。 */
import type { VoiceTranscribeAdapter } from '@/components/voiceInput/types'

/** 明确返回带演示标记的结果，不把音频上传到任何服务。 */
export const transcribeDemoAudio: VoiceTranscribeAdapter = async (audio, { signal }) => {
  signal.throwIfAborted()
  if (audio.size === 0) throw new Error('没有采集到音频')
  return `[演示转写] 已采集 ${Math.ceil(audio.size / 1024)} KB 音频，请在转写适配器中接入识别服务。`
}
