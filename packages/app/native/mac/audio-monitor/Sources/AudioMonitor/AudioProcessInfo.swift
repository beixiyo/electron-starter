// 定义 audio-monitor 输出给 Electron 的进程快照

import Foundation

/// audio-monitor 输出给 Electron 的单个活跃音频进程快照
struct AudioProcessInfo: Encodable {
  let pid: Int
  let name: String
  let bundleId: String
  /// 可执行文件绝对路径，上层据此识别输入法（`*/Library/Input Methods/`）等结构性目录
  let executablePath: String
  let isRunningInput: Bool
  let isRunningOutput: Bool
}
