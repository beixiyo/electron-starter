// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "AudioMonitor",
  platforms: [.macOS("14.2")],
  products: [
    .executable(name: "audio-monitor", targets: ["AudioMonitor"]),
  ],
  targets: [
    .executableTarget(
      name: "AudioMonitor",
      linkerSettings: [
        .linkedFramework("Cocoa"),
        .linkedFramework("CoreAudio"),
      ],
    ),
  ],
)
