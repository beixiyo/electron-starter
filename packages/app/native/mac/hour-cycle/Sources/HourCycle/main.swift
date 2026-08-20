// 读取 macOS 当前用户实际生效的 12/24 小时制

import Foundation

@main
struct HourCycleReader {
  static func main() {
    let hourCycle = Locale.autoupdatingCurrent.hourCycle
    guard let value = hourCycleValue(hourCycle) else { return }
    print(value)
  }

  private static func hourCycleValue(_ hourCycle: Locale.HourCycle) -> String? {
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
