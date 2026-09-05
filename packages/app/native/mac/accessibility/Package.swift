// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "AccessibilityHelpers",
  platforms: [.macOS(.v11)],
  products: [
    .library(name: "FnListenerCore", targets: ["FnListenerCore"]),
    .executable(name: "focus-check", targets: ["FocusCheck"]),
    .executable(name: "fn-listener", targets: ["FnListener"]),
    .executable(name: "settings-window", targets: ["SettingsWindow"]),
    .executable(name: "insert-text", targets: ["InsertText"]),
  ],
  targets: [
    .target(name: "FnListenerCore"),
    .executableTarget(
      name: "FocusCheck",
      linkerSettings: [
        .linkedFramework("Cocoa"),
        .linkedFramework("ApplicationServices"),
      ],
    ),
    .executableTarget(
      name: "InsertText",
      linkerSettings: [
        .linkedFramework("Cocoa"),
        .linkedFramework("ApplicationServices"),
        .linkedFramework("CoreGraphics"),
      ],
    ),
    .executableTarget(
      name: "SettingsWindow",
      linkerSettings: [
        .linkedFramework("Cocoa"),
        .linkedFramework("CoreGraphics"),
      ],
    ),
    .executableTarget(
      name: "FnListener",
      dependencies: ["FnListenerCore"],
      linkerSettings: [
        .linkedFramework("Cocoa"),
        .linkedFramework("CoreGraphics"),
      ],
    ),
  ],
)
