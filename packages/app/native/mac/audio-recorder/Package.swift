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
        "MicrophoneSignalProcessor.swift",
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
