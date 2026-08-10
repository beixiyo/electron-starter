// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "AudioRecorder",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "audio-recorder", targets: ["AudioRecorder"]),
  ],
  targets: [
    .executableTarget(
      name: "AudioRecorder",
      path: ".",
      exclude: [
        "README.md",
        "MACOS-PITFALLS.md",
      ],
      sources: [
        "AudioSettings.swift",
        "Checkpoint.swift",
        "Commands.swift",
        "Constants.swift",
        "Logging.swift",
        "Permissions.swift",
        "RecoveryMixing.swift",
        "SCKRecorder.swift",
        "TapRecorder.swift",
        "main.swift",
      ],
      linkerSettings: [
        .linkedFramework("AVFoundation"),
        .linkedFramework("Cocoa"),
        .linkedFramework("CoreAudio"),
        .linkedFramework("CoreGraphics"),
        .linkedFramework("CoreMedia"),
        .linkedFramework("ScreenCaptureKit"),
      ],
    ),
  ],
)
