// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "ScreenshotCapture",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "screenshot-capture", targets: ["ScreenshotCapture"]),
  ],
  targets: [
    .executableTarget(
      name: "ScreenshotCapture",
      linkerSettings: [
        .linkedFramework("CoreGraphics"),
        .linkedFramework("ImageIO"),
        .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("UniformTypeIdentifiers"),
      ],
    ),
  ],
)
