// 解析 audio-monitor 启动参数、装配服务并运行主循环

import CoreFoundation
import Darwin

/// 常驻进程入口：解析轮询间隔，启动 Core Audio 监听并维持主 RunLoop
var pollInterval: Double = 3
let arguments = CommandLine.arguments

for index in 1..<arguments.count {
  guard arguments[index] == "--interval", index + 1 < arguments.count,
        let value = Double(arguments[index + 1]), value > 0 else { continue }
  pollInterval = value
}

// 父进程退出导致 stdout 管道断开时，由输出器检测写入失败并正常结束进程
signal(SIGPIPE, SIG_IGN)

let monitor = AudioMonitorService(pollInterval: pollInterval)
monitor.start()
CFRunLoopRun()
