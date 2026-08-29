// swift-tools-version: 6.1

import PackageDescription

let package = Package(
  name: "AudioProcessingTests",
  platforms: [.macOS(.v14)],
  dependencies: [
    .package(path: ".."),
    .package(
      url: "https://github.com/swiftlang/swift-testing.git",
      revision: "swift-6.2.1-RELEASE"
    ),
  ],
  targets: [
    .testTarget(
      name: "AudioProcessingTests",
      dependencies: [
        .product(name: "AudioProcessing", package: "audio-recorder"),
        .product(name: "Testing", package: "swift-testing"),
      ],
      path: "AudioProcessingTests"
    ),
  ]
)
