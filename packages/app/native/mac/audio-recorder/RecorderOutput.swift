// 输出 SCK 与 process tap 引擎共用的 stdout NDJSON 协议

import Darwin
import Foundation

/** 输出录音生命周期状态及其所属产物 */
func emitStatus(
  _ status: String,
  path: String,
  duration: Double? = nil,
  handoffId: Int? = nil,
  micStrategy: MicCaptureStrategy? = nil,
  micDeviceKey: String? = nil,
  outputTransport: String? = nil,
  trackSampleCounts: (system: Int, mic: Int)? = nil,
  systemAudioDiagnostics: (requested: Bool, callbacks: Int, drops: Int)? = nil
) {
  var json = "{\"status\":\"\(status)\",\"path\":\"\(escapeJSON(path))\""
  if let d = duration {
    json += ",\"duration\":\(String(format: "%.1f", d))"
  }
  if let handoffId {
    json += ",\"handoffId\":\(handoffId)"
  }
  if let micStrategy, let micDeviceKey {
    json += ",\"micStrategy\":\"\(escapeJSON(micStrategy.rawValue))\""
    json += ",\"micDeviceKey\":\"\(escapeJSON(micDeviceKey))\""
  }
  if let outputTransport {
    json += ",\"outputTransport\":\"\(escapeJSON(outputTransport))\""
  }
  if let trackSampleCounts {
    json += ",\"systemAudioAppends\":\(trackSampleCounts.system)"
    json += ",\"micAppends\":\(trackSampleCounts.mic)"
  }
  if let systemAudioDiagnostics {
    /**
     * 原始回调数与写入数必须分开上报
     *
     * 只看 appends 无法区分两种完全不同的故障:callbacks=0 表示 IOProc 压根没跑
     * （tap 挂上了但内核侧没出数据）；callbacks>0 而 appends=0 表示出了数据但全被
     * 丢弃或忽略。二者的排查方向不同
     */
    json += ",\"systemAudioRequested\":\(systemAudioDiagnostics.requested)"
    json += ",\"systemAudioCallbacks\":\(systemAudioDiagnostics.callbacks)"
    json += ",\"systemAudioDrops\":\(systemAudioDiagnostics.drops)"
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/**
 * 输出非致命诊断事件
 *
 * 刻意不用 emitError——TS 侧对未白名单的 error code 会重置录音状态机并经 discard 链路删除已录音频
 * 未知 status 可安全忽略，需要产品层持久化或提示的降级信号由 TS 显式消费
 */
func emitDiagnostic(_ status: String, detail: String) {
  let json = "{\"status\":\"\(escapeJSON(status))\",\"detail\":\"\(escapeJSON(detail))\"}"
  print(json)
  fflush(stdout)
}

/** 回传启动预检选中的麦克风路线；设备键只在 Electron 主进程内存中流转 */
func emitMicProbeComplete(
  strategy: MicCaptureStrategy,
  deviceKey: String
) {
  var json = "{\"status\":\"mic_probe_complete\",\"micStrategy\":\"\(escapeJSON(strategy.rawValue))\",\"micDeviceKey\":\"\(escapeJSON(deviceKey))\""
  json += "}"
  print(json)
  fflush(stdout)
}

/**
 * 录音中途麦克风重挂成功
 *
 * 实测症状:某条 75 分钟长录音的中段本底噪声抬高约 35dB 并再未恢复，
 * 全程无任何默认级别日志可解释。根因候选之一就是这里——重挂会重新走一遍路线探测，
 * 可能落到与开场不同的采集路线，导致输入设备或格式发生变化
 *
 * 方案边界:只上报既成事实，不改变任何重挂或降级判断。`mic_degraded` 只在重挂彻底失败时发出，
 * 覆盖不到「重挂成功但换了路线」这一类静默降级
 */
func emitMicRouteChanged(
  reason: String,
  strategy: MicCaptureStrategy?
) {
  var json = "{\"status\":\"mic_route_changed\",\"reason\":\"\(escapeJSON(reason))\""
  if let strategy {
    json += ",\"micStrategy\":\"\(escapeJSON(strategy.rawValue))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/**
 * 录音中热挂系统音轨失败
 *
 * 实测症状:某台机器 tap 在 start 阶段挂载成功（否则整场录音会直接报错），却全程 0 回调，
 * 成品只剩麦克风轨，用户毫无察觉。首样本看门狗的条件是「两轨样本合计为 0」，
 * mic 正常时它永远不会触发，整条系统音轨死掉对它不可见
 *
 * 方案边界:只上报失败事实与阶段，不改变现有「mic 轨继续录」的降级行为——那是刻意为之，
 * 丢掉系统音也好过整场失败
 */
func emitTapAttachFailed(phase: String, detail: String) {
  let json = "{\"status\":\"tap_attach_failed\",\"phase\":\"\(escapeJSON(phase))\",\"detail\":\"\(escapeJSON(detail))\"}"
  print(json)
  fflush(stdout)
}

/**
 * 输出归一化麦克风音量（0~1），供渲染层画光效
 *
 * 单独一条消息而不是塞进 `emitDiagnostic`：这条按 15Hz 持续发送，
 * 混进诊断流会把真正的降级信号淹掉，日志侧也没法分开采样
 */
func emitAudioLevel(_ level: Double) {
  print("{\"status\":\"audio_level\",\"level\":\(String(format: "%.2f", level))}")
  fflush(stdout)
}

/** 输出尚未绑定到具体录音产物的错误 */
func emitError(_ error: String, detail: String? = nil) {
  var json = "{\"error\":\"\(escapeJSON(error))\""
  if let detail {
    json += ",\"detail\":\"\(escapeJSON(detail))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/** 输出录音中错误并携带所属产物，消费层可拒绝已被下一场录音取代的迟到事件 */
func emitRecordingError(_ error: String, path: String, detail: String? = nil) {
  var json = "{\"error\":\"\(escapeJSON(error))\",\"path\":\"\(escapeJSON(path))\""
  if let detail {
    json += ",\"detail\":\"\(escapeJSON(detail))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/** 输出录音收尾失败 terminal，业务层据产物路径和 handoff 拒绝旧错误污染新 session */
func emitTerminalError(_ error: String, path: String, detail: String? = nil, handoffId: Int? = nil) {
  var json = "{\"error\":\"\(escapeJSON(error))\",\"terminal\":true,\"path\":\"\(escapeJSON(path))\""
  if let handoffId {
    json += ",\"handoffId\":\(handoffId)"
  }
  if let detail {
    json += ",\"detail\":\"\(escapeJSON(detail))\""
  }
  json += "}"
  print(json)
  fflush(stdout)
}

/** 通知主进程在指定 handoff 后回收 helper */
func emitRecycleDirective(handoffId: Int, detail: String) {
  let json = "{\"status\":\"recycle_required\",\"handoffId\":\(handoffId),\"detail\":\"\(escapeJSON(detail))\"}"
  print(json)
  fflush(stdout)
}
