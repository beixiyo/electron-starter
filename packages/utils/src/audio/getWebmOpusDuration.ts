/**
 * 解析 WebM 容器中的 Opus 音频时长
 *
 * MediaRecorder 产物可能没有 Duration/Cues，时间轴也可能包含没有音频帧的空洞
 * 因此按 Opus packet 的 TOC 累计实际编码采样数，不使用最后一个 packet 的时间戳
 */
import { BlobSource, EncodedPacketSink, Input, WEBM } from 'mediabunny'

const OPUS_SAMPLE_RATE = 48_000

/** RFC 6716 sections 3.1 and 3.2: Opus TOC config 对应的单帧采样数 */
const OPUS_FRAME_DURATION_SAMPLES = [
  480,
  960,
  1920,
  2880,
  480,
  960,
  1920,
  2880,
  480,
  960,
  1920,
  2880,
  480,
  960,
  480,
  960,
  120,
  240,
  480,
  960,
  120,
  240,
  480,
  960,
  120,
  240,
  480,
  960,
  120,
  240,
  480,
  960,
] as const

/**
 * 从 WebM Blob 的 Opus packets 计算实际编码内容时长（秒）
 *
 * 不依赖 WebM Duration/Cues，也不会把 packet 时间戳之间的空洞计入时长
 * 无法读取容器、找不到 Opus 音轨或遇到无效 packet 时返回 `undefined`
 */
export async function getWebmOpusDuration(blob: Blob): Promise<number | undefined> {
  const input = new Input({
    source: new BlobSource(blob),
    formats: [WEBM],
  })

  try {
    if (!await input.canRead())
      return undefined

    const track = await input.getPrimaryAudioTrack()
    if (!track || track.codec !== 'opus')
      return undefined

    const sink = new EncodedPacketSink(track)
    let packet = await sink.getFirstPacket()
    let totalSamples = 0

    while (packet) {
      const packetSamples = getOpusPacketDurationSamples(packet.data)
      if (packetSamples == null)
        return undefined

      totalSamples += packetSamples
      packet = await sink.getNextPacket(packet)
    }

    return totalSamples > 0
      ? totalSamples / OPUS_SAMPLE_RATE
      : undefined
  }
  catch {
    return undefined
  }
  finally {
    input.dispose()
  }
}

/** 从 Opus packet 的 TOC 和 frame count 推导其采样数 */
function getOpusPacketDurationSamples(packet: Uint8Array): number | undefined {
  const toc = packet[0]
  if (toc == null) return undefined

  const frameDurationSamples = OPUS_FRAME_DURATION_SAMPLES[toc >> 3]
  if (frameDurationSamples == null) return undefined

  const code = toc & 0b11
  const frameCount = code === 0
    ? 1
    : code === 1 || code === 2
    ? 2
    : packet[1] == null
    ? 0
    : packet[1] & 0b11_1111

  const durationSamples = frameDurationSamples * frameCount
  return frameCount > 0 && durationSamples <= 5760
    ? durationSamples
    : undefined
}
