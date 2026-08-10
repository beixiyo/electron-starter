// 从系统进程和应用包解析 audio-monitor 的显示元数据

import Cocoa

/// 从系统进程与应用包中解析 audio-monitor 输出所需的显示元数据
struct ProcessMetadataResolver {
  func resolve(pid: Int) -> ProcessMetadata {
    let executablePath = executablePath(pid: pid)

    if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
      let bundleId = app.bundleIdentifier ?? ""
      if !bundleId.isEmpty {
        return ProcessMetadata(
          name: app.localizedName ?? "pid-\(pid)",
          bundleId: bundleId,
          executablePath: executablePath
        )
      }
    }

    guard !executablePath.isEmpty else {
      return ProcessMetadata(name: "pid-\(pid)", bundleId: "", executablePath: "")
    }

    return ProcessMetadata(
      name: (executablePath as NSString).lastPathComponent,
      bundleId: bundleIdFromExecutablePath(executablePath),
      executablePath: executablePath
    )
  }

  private func executablePath(pid: Int) -> String {
    let maxPathSize = 4 * Int(MAXPATHLEN)
    var pathBuffer = [CChar](repeating: 0, count: maxPathSize)
    guard proc_pidpath(pid_t(pid), &pathBuffer, UInt32(maxPathSize)) > 0 else { return "" }
    return String(cString: pathBuffer)
  }

  /// Electron Renderer helper 通常不注册到 Launch Services，需要从其可执行文件向上回溯 `.app`
  private func bundleIdFromExecutablePath(_ fullPath: String) -> String {
    var url = URL(fileURLWithPath: fullPath)

    while url.path != "/" {
      url = url.deletingLastPathComponent()
      if url.pathExtension == "app", let bundleId = Bundle(url: url)?.bundleIdentifier {
        return bundleId
      }
    }

    return ""
  }
}

struct ProcessMetadata {
  let name: String
  let bundleId: String
  let executablePath: String
}
