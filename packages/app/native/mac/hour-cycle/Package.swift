// swift-tools-version: 5.9

// macOS 小时制读取 helper 的 SwiftPM manifest

import PackageDescription

let package = Package(
  name: "HourCycle",
  platforms: [.macOS("14.2")],
  products: [
    .executable(name: "hour-cycle", targets: ["HourCycle"]),
  ],
  targets: [
    .executableTarget(name: "HourCycle"),
  ],
)
