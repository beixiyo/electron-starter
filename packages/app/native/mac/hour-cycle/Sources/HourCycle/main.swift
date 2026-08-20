// 读取 macOS 当前用户实际生效的 12/24 小时制

import Foundation

@main
struct HourCycleReader {
  static func main() {
    if CommandLine.arguments.contains("--watch") {
      watchHourCycle()
      return
    }

    let hourCycle = Locale.autoupdatingCurrent.hourCycle
    guard let value = hourCycleValue(hourCycle) else { return }
    print(value)
  }

  private static func watchHourCycle() {
    let observer = UserDefaultsHourCycleObserver()
    let keepAlive = Timer(timeInterval: 60, repeats: true) { _ in }
    RunLoop.main.add(keepAlive, forMode: .common)

    withExtendedLifetime(observer) {
      withExtendedLifetime(keepAlive) {
        RunLoop.main.run()
      }
    }
  }

  fileprivate static func hourCycleValue(_ hourCycle: Locale.HourCycle) -> String? {
    switch hourCycle {
    case .zeroToTwentyThree, .oneToTwentyFour:
      return "24"
    case .zeroToEleven, .oneToTwelve:
      return "12"
    @unknown default:
      return nil
    }
  }
}

/** 监听系统设置进程对全局 UserDefaults 的小时制修改 */
private final class UserDefaultsHourCycleObserver: NSObject {
  private let defaults = UserDefaults.standard
  private let force24HourKey = "AppleICUForce24HourTime"
  private let force12HourKey = "AppleICUForce12HourTime"

  override init() {
    super.init()
    defaults.addObserver(self, forKeyPath: force24HourKey, options: [.initial, .new], context: nil)
    defaults.addObserver(self, forKeyPath: force12HourKey, options: [.initial, .new], context: nil)
  }

  deinit {
    defaults.removeObserver(self, forKeyPath: force24HourKey)
    defaults.removeObserver(self, forKeyPath: force12HourKey)
  }

  override func observeValue(
    forKeyPath keyPath: String?,
    of object: Any?,
    change: [NSKeyValueChangeKey: Any]?,
    context: UnsafeMutableRawPointer?,
  ) {
    guard keyPath == force24HourKey || keyPath == force12HourKey else {
      super.observeValue(forKeyPath: keyPath, of: object, change: change, context: context)
      return
    }

    let hourCycle = Locale.autoupdatingCurrent.hourCycle
    guard let value = HourCycleReader.hourCycleValue(hourCycle) else { return }
    FileHandle.standardOutput.write(Data("\(value)\n".utf8))
  }
}
