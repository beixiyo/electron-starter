/**
 一次性捕获指定显示器的原始 PNG，并通过逐帧长度前缀二进制协议写入 stdout

 stdout 只承载协议数据，错误写入 stderr。单进程只枚举一次 SCShareableContent，
 ScreenCaptureKit 对象始终由专用 actor 隔离；多显示器在系统截图 await 期间并发，
 编码和 stdout 写入串行执行，避免同时保留所有显示器 PNG
 */

import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

private let protocolMagic = Data("ESSHOT2\n".utf8)

@main
struct ScreenshotCapture {
  static func main() async {
    do {
      if CommandLine.arguments.dropFirst() == ["--warmup"] {
        _ = try await SCShareableContent.excludingDesktopWindows(
          false,
          onScreenWindowsOnly: true
        )
        return
      }

      let displayIDs = try parseDisplayIDs()
      try await captureDisplays(displayIDs)
    }
    catch {
      writeError(error)
      Foundation.exit(EXIT_FAILURE)
    }
  }
}

private func parseDisplayIDs() throws -> [CGDirectDisplayID] {
  let arguments = CommandLine.arguments.dropFirst()
  guard !arguments.isEmpty else {
    throw CaptureError.missingDisplayIDs
  }

  return try arguments.map { value in
    guard let displayID = CGDirectDisplayID(value), displayID > 0 else {
      throw CaptureError.invalidDisplayID(value)
    }
    return displayID
  }
}

private func captureDisplays(_ requestedIDs: [CGDirectDisplayID]) async throws {
  let coordinator = DisplayCaptureCoordinator()
  try await coordinator.prepare(requestedIDs)
  try writeResponseHeader(captureCount: requestedIDs.count)

  try await withThrowingTaskGroup(of: Void.self) { group in
    for displayID in requestedIDs {
      group.addTask {
        try await coordinator.captureAndWrite(displayID)
      }
    }

    try await group.waitForAll()
  }
}

private actor DisplayCaptureCoordinator {
  private var displaysByID: [CGDirectDisplayID: SCDisplay] = [:]

  func prepare(_ requestedIDs: [CGDirectDisplayID]) async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false,
      onScreenWindowsOnly: true
    )
    displaysByID = Dictionary(uniqueKeysWithValues: content.displays.map { ($0.displayID, $0) })

    for displayID in requestedIDs where displaysByID[displayID] == nil {
      throw CaptureError.displayNotFound(displayID)
    }
  }

  func captureAndWrite(_ displayID: CGDirectDisplayID) async throws {
    guard let display = displaysByID[displayID] else {
      throw CaptureError.displayNotFound(displayID)
    }

    let filter = SCContentFilter(
      display: display,
      excludingApplications: [],
      exceptingWindows: []
    )
    let pointPixelScale = CGFloat(filter.pointPixelScale)
    let pixelWidth = max(Int((CGFloat(display.width) * pointPixelScale).rounded()), 1)
    let pixelHeight = max(Int((CGFloat(display.height) * pointPixelScale).rounded()), 1)

    let configuration = SCStreamConfiguration()
    configuration.width = pixelWidth
    configuration.height = pixelHeight
    configuration.captureResolution = .best
    configuration.scalesToFit = false
    configuration.showsCursor = false
    configuration.shouldBeOpaque = true

    let image = try await SCScreenshotManager.captureImage(
      contentFilter: filter,
      configuration: configuration
    )
    let capture = CapturedDisplay(
      displayID: display.displayID,
      width: image.width,
      height: image.height,
      pngData: try encodePNG(image)
    )
    try writeCapture(capture)
  }
}

private func encodePNG(_ image: CGImage) throws -> Data {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(
    data,
    UTType.png.identifier as CFString,
    1,
    nil
  ) else {
    throw CaptureError.pngDestinationCreationFailed
  }

  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw CaptureError.pngEncodingFailed
  }
  return data as Data
}

private func writeResponseHeader(captureCount: Int) throws {
  guard captureCount <= UInt32.max else {
    throw CaptureError.captureCountTooLarge
  }

  let output = FileHandle.standardOutput
  output.write(protocolMagic)
  writeUInt32(UInt32(captureCount), to: output)
}

private func writeCapture(_ capture: CapturedDisplay) throws {
  let metadata = CaptureMetadata(
    displayId: UInt32(capture.displayID),
    width: capture.width,
    height: capture.height,
    byteLength: capture.pngData.count
  )
  let metadataData = try JSONEncoder().encode(metadata)
  guard metadataData.count <= UInt32.max else {
    throw CaptureError.metadataTooLarge
  }

  let output = FileHandle.standardOutput
  writeUInt32(UInt32(metadataData.count), to: output)
  output.write(metadataData)
  output.write(capture.pngData)
}

private func writeUInt32(_ value: UInt32, to output: FileHandle) {
  var bigEndianValue = value.bigEndian
  withUnsafeBytes(of: &bigEndianValue) { output.write(Data($0)) }
}

private func writeError(_ error: Error) {
  let message = "screenshot-capture: \(error.localizedDescription)\n"
  FileHandle.standardError.write(Data(message.utf8))
}

private struct CapturedDisplay {
  let displayID: CGDirectDisplayID
  let width: Int
  let height: Int
  let pngData: Data
}

private struct CaptureMetadata: Encodable {
  let displayId: UInt32
  let width: Int
  let height: Int
  let byteLength: Int
}

private enum CaptureError: LocalizedError {
  case missingDisplayIDs
  case invalidDisplayID(String)
  case displayNotFound(CGDirectDisplayID)
  case pngDestinationCreationFailed
  case pngEncodingFailed
  case captureCountTooLarge
  case metadataTooLarge

  var errorDescription: String? {
    switch self {
      case .missingDisplayIDs:
        return "at least one display ID is required"
      case let .invalidDisplayID(value):
        return "invalid display ID: \(value)"
      case let .displayNotFound(displayID):
        return "display not found: \(displayID)"
      case .pngDestinationCreationFailed:
        return "could not create PNG destination"
      case .pngEncodingFailed:
        return "could not encode PNG"
      case .captureCountTooLarge:
        return "response contains too many displays"
      case .metadataTooLarge:
        return "response metadata is too large"
    }
  }
}
