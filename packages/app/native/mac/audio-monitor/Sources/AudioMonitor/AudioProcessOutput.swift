// 编码稳定的逐行 JSON，并抑制重复进程快照

import Darwin
import Foundation

/// 将进程快照编码为稳定的逐行 JSON，并抑制与上一次完全相同的输出
final class AudioProcessOutput {
  private let encoder: JSONEncoder
  private var lastPayload: Data?

  init() {
    encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
  }

  func write(_ processes: [AudioProcessInfo]) {
    guard let payload = try? encoder.encode(processes),
          payload != lastPayload,
          let line = String(data: payload, encoding: .utf8) else { return }
    lastPayload = payload

    print(line)
    if fflush(stdout) != 0 {
      exit(0)
    }
  }
}
