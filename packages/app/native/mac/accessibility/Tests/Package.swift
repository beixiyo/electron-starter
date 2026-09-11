// swift-tools-version: 6.1

import PackageDescription

let package = Package(
  name: "KeyboardListenerCoreTests",
  platforms: [.macOS(.v11)],
  dependencies: [
    .package(path: ".."),
    .package(
      url: "https://github.com/swiftlang/swift-testing.git",
      revision: "swift-6.2.1-RELEASE"
    ),
  ],
  targets: [
    .testTarget(
      name: "KeyboardListenerCoreTests",
      dependencies: [
        .product(name: "KeyboardListenerCore", package: "accessibility"),
        .product(name: "Testing", package: "swift-testing"),
      ]
    ),
  ]
)
