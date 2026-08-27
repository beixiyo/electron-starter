// 把麦克风 PCM 的 RMS 规格化成 0~1 的可视强度，节流后经 stdout NDJSON 上报

import Foundation

/**
 * 归一化麦克风音量，供渲染层画光效 / 波形
 *
 * 只读不改：取的是**增益之前**的 RMS。`MicrophoneSignalProcessor` 的 AGC 会把
 * 人声推向 -18 dBFS 的恒定目标，读处理后的电平等于读一条几乎不动的直线，
 * 大声小声都长一样。落盘音频完全不受本类影响
 *
 * 全局单例是因为上报口是进程级的 stdout：一场录音里麦克风可能被重挂、
 * `MicrophoneSignalProcessor` 会跟着重建，而节流状态必须跨重建连续，
 * 否则每次重挂都会立刻多打一帧
 */
final class AudioLevelMeter {
  static let shared = AudioLevelMeter()

  private enum Policy {
    /**
     * 静音地板，与 `MicrophoneSignalProcessor.Policy.signalRMSFloorDbFS` 同源
     *
     * 两者必须一致：那边判定「这一帧算不算人声」，这边决定「光效亮不亮」，
     * 分开取值会出现处理器认为有人声而光效仍然全黑的矛盾状态
     */
    static let floorDbFS = -50.0
    /**
     * 满量程
     *
     * 常规音量说话的 RMS 落在 -24 ~ -15 dBFS，取 -15 让正常说话就能顶到接近 1，
     * 而不是必须喊。取 0 dBFS 的话日常说话只能推到三成，光效几乎不动
     */
    static let ceilingDbFS = -15.0
    /** 上报间隔，约 15Hz；再密也只是喂给一个正在做 100ms 过渡的属性 */
    static let emitIntervalSeconds = 0.066
    /**
     * 相邻两帧之间的平滑系数（新值权重）
     *
     * 单个 1024 帧的缓冲只有 21ms，逐帧上报会让光效抖成噪点。
     * 0.35 是「跟得上说话起伏」与「不抖」之间的折中
     */
    static let smoothing = 0.35
  }

  private let lock = NSLock()
  private var smoothedLevel = 0.0
  private var lastEmitTime: TimeInterval = 0
  private var lastEmittedLevel = -1.0

  private init() {}

  /**
   * 提交一帧的输入 RMS（线性幅度，非 dB）
   *
   * 在采集队列上调用，本身不做任何 I/O 以外的重活；真正的上报按 {@link Policy.emitIntervalSeconds} 节流
   */
  func submit(inputRMS rms: Float) {
    let level = Self.normalize(rms: Double(rms))

    lock.lock()
    smoothedLevel += (level - smoothedLevel) * Policy.smoothing
    let now = Date().timeIntervalSince1970
    guard now - lastEmitTime >= Policy.emitIntervalSeconds else {
      lock.unlock()
      return
    }
    lastEmitTime = now
    let rounded = (smoothedLevel * 100).rounded() / 100
    /** 静音时电平恒为 0，重复上报同一个值没有信息量，只是白白唤醒渲染进程 */
    guard rounded != lastEmittedLevel else {
      lock.unlock()
      return
    }
    lastEmittedLevel = rounded
    lock.unlock()

    emitAudioLevel(rounded)
  }

  /** 新一场录音开始前清空，避免上一场的末帧电平被当成本场首帧 */
  func reset() {
    lock.lock()
    smoothedLevel = 0
    lastEmitTime = 0
    lastEmittedLevel = -1
    lock.unlock()
  }

  /** dBFS 线性映射到 0~1，地板以下取 0，满量程以上截到 1 */
  private static func normalize(rms: Double) -> Double {
    guard rms > 0 else { return 0 }

    let dbFS = 20 * log10(rms)
    guard dbFS > Policy.floorDbFS else { return 0 }

    let ratio = (dbFS - Policy.floorDbFS) / (Policy.ceilingDbFS - Policy.floorDbFS)
    return min(1, max(0, ratio))
  }
}
