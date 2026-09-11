// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "AccessibilityHelpers",
  platforms: [.macOS(.v11)],
  products: [
    .library(name: "KeyboardListenerCore", targets: ["KeyboardListenerCore"]),
    .executable(name: "focus-check", targets: ["FocusCheck"]),
    .executable(name: "keyboard-listener", targets: ["KeyboardListener"]),
    .executable(name: "settings-window", targets: ["SettingsWindow"]),
    .executable(name: "insert-text", targets: ["InsertText"]),
  ],
  targets: [
    .target(name: "KeyboardListenerCore"),
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
      name: "KeyboardListener",
      dependencies: ["KeyboardListenerCore"],
      linkerSettings: [
        .linkedFramework("Cocoa"),
        .linkedFramework("CoreGraphics"),
      ],
    ),
  ],
)
