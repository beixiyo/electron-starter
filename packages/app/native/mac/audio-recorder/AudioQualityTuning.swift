// 集中定义录音编码、最终混音响度与 tap 时钟补偿的可调质量策略

import AVFoundation
import CoreAudio

/// Apple AAC 编码器在本项目双声道输出中接受的原生采样率
///
/// process tap、实时 writer 与离线混音共用同一份能力集合；其它采样率统一回退 48 kHz
let SUPPORTED_AAC_SAMPLE_RATES: Set<Double> = [
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
]

/// 系统音轨与最终混音成品共用的 AAC 目标码率上限
///
/// 默认 `320_000` bit/s，优先减少浏览器音乐被再次 AAC 编码时的细节损失；
/// 44.1/48 kHz 下手动 A/B 可尝试 `256_000` 或 `192_000` 以换取更小文件
/// 低采样率会在 AudioSettings 边界按 Apple AAC 编码器能力自动降低实际码率
/// 提高码率主要增加文件体积，也可能略增编码与 I/O 负担；它不改变 PCM 峰值，不会单独引入削波
let SYSTEM_AUDIO_AAC_BIT_RATE = 320_000

/// 系统音轨与最终混音成品共用的 AAC 编码质量
///
/// 默认 `.max`；CPU 紧张时可 A/B `.high`，以较低编码开销换取可能的细节损失
/// 该参数不改变混音增益，因此不会单独引入削波
let SYSTEM_AUDIO_AAC_ENCODER_QUALITY: AVAudioQuality = .max

/// SCK 实时麦克风轨的单声道 AAC 码率
///
/// 默认 `128_000` bit/s，给后续多轨混音的二次编码留出余量；主要录语音且更关心文件体积时可 A/B `96_000`
/// tap 引擎的 mic 先写无损 PCM sidecar，不使用该参数
let MIC_AUDIO_AAC_BIT_RATE = 128_000

/// 无法从主系统音轨读取受支持采样率时的混音回退值
///
/// 默认 `48_000` Hz，和 SCK、麦克风 sidecar 的采集格式一致；正常的 44.1 / 48 kHz
/// process tap 会优先保留自身采样率，不会使用该回退值
let AUDIO_FALLBACK_SAMPLE_RATE: Double = 48_000

/// 纯系统音成品的线性增益
///
/// 默认 `1.0`，因此连续单轨可以直接保留首次 AAC，不改变数字幅度。若实机 A/B 仍觉得
/// 略小，可尝试 `1.05` 或 `1.1`；非 `1.0` 会强制离线 render，超过 `1.0` 时启用限幅器，
/// 会增加一次 AAC 编码且无法保证所有内容都等比例变响，因此不应把它当作响度归一化
let SYSTEM_AUDIO_VOLUME_WITHOUT_MIC: Float = 1

/// tap 引擎的系统音与有效麦克风 sidecar 共同收尾时，系统轨的线性增益
///
/// 默认 `0.75`（约 -2.50 dB）；可 A/B `0.5`（约 -6.02 dB，给人声留更多空间）与 `1.0`
/// 增益计算的 CPU 成本可忽略；`1.0` 不衰减系统音，但两轨叠加时更容易削波
/// SCK 依据 writer 的 system=2ch / mic=1ch 格式契约只将该增益施加到系统轨
let SYSTEM_AUDIO_VOLUME_WITH_MIC: Float = 0.75

/// 多轨离线混音的 sample-peak 限幅上限
///
/// 用于同时存在两条或以上混音轨道，或纯系统音增益大于 1 的 render 路径；默认 0.95
///（约 -0.45 dBFS），为编码器和后续播放保留少量峰值余量。1 倍纯系统音 passthrough
/// 和未增益的单轨时间线 render 不会经过限幅
/// 可 A/B 调整到 `1.0` 观察满幅结果，但多轨叠加更容易在后续处理或编码中削波。
let AUDIO_LIMITER_CEILING: Float = 0.95

/// 多轨限幅器从衰减状态恢复到 1.0 增益的时间常数
///
/// 80 ms 只控制 release；超过 ceiling 时仍按当前帧即时 attack，避免跨声道峰值溢出。
let AUDIO_LIMITER_RELEASE_SECONDS: Double = 0.08

/// process tap 聚合设备的时钟漂移补偿质量
///
/// 默认 `kAudioAggregateDriftCompensationMaxQuality`；CPU 紧张时可 A/B
/// `kAudioAggregateDriftCompensationHighQuality` 或 `kAudioAggregateDriftCompensationMediumQuality`
/// 降低质量可能减少重采样开销，但会增加长录音同步与音质退化风险；它不改变轨道增益，不会单独引入削波
let TAP_DRIFT_COMPENSATION_QUALITY: UInt32 = kAudioAggregateDriftCompensationMaxQuality
