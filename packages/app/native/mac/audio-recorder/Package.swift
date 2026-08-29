// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "AudioRecorder",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "audio-recorder", targets: ["AudioRecorder"]),
    .library(name: "AudioProcessing", targets: ["AudioProcessing"]),
  ],
  targets: [
    .binaryTarget(
      name: "RecorderAPM",
      path: "Vendor/RecorderAPM.xcframework"
    ),
    .target(
      name: "AudioProcessing",
      dependencies: ["RecorderAPM"],
      path: "AudioProcessing",
      linkerSettings: [
        .linkedFramework("AVFoundation"),
        .linkedFramework("CoreMedia"),
        .linkedLibrary("c++"),
      ]
    ),
    .executableTarget(
      name: "AudioRecorder",
      dependencies: ["AudioProcessing"],
      path: ".",
      exclude: [
        "README.md",
        "MACOS-PITFALLS.md",
        "APMShim",
        "AudioProcessing",
        "Tests",
        "Vendor",
      ],
      sources: [
        "AudioAssetInspector.swift",
        "AudioDeviceDiagnostics.swift",
        "AudioLevelMeter.swift",
        "AudioMixPlan.swift",
        "AudioPeakLimiter.swift",
        "AudioQualityTuning.swift",
        "AudioSettings.swift",
        "AudioTrackMixer.swift",
        "AudioWriterSetup.swift",
        "Checkpoint.swift",
        "CheckpointRecovery.swift",
        "Commands.swift",
        "Constants.swift",
        "ErrorDiagnostics.swift",
        "Logging.swift",
        "MicSidecarRecovery.swift",
        "MicSidecarTransaction.swift",
        "MicSidecarTransactionStore.swift",
        "Permissions.swift",
        "ProcessLifecycle.swift",
        "RecorderCoordinator.swift",
        "RecorderOutput.swift",
        "SCKRecorder.swift",
        "TapMicCapture.swift",
        "TapMicSidecarWriter.swift",
        "TapProcessCapture.swift",
        "TapRecordingTimeline.swift",
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
