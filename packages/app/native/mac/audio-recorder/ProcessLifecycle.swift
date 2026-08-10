// 串行化 stdin 命令，并统一管理 helper 的退出与录音收尾

import Darwin
import Dispatch
import Foundation

/**
 * 常驻 helper 的进程生命周期所有者
 *
 * 持有命令串行链、SIGTERM source、父进程探测 timer 与 finalize watchdog，确保命令和退出收尾不交错
 * 跨线程可变状态由 commandChainQueue 串行保护，DispatchSource 只在 start 时配置一次
 */
final class ProcessLifecycle: @unchecked Sendable {
  private let coordinator = RecorderCoordinator()
  private let commandChainQueue = DispatchQueue(label: "audio-recorder-command-chain")
  private var commandTail: Task<Void, Never> = Task {}
  private var started = false
  private var finalizeRequested = false
  private var sigTermSource: DispatchSourceSignal?
  private var parentCheckTimer: DispatchSourceTimer?

  func start() {
    let shouldStart = commandChainQueue.sync {
      guard !started else { return false }
      started = true
      return true
    }
    guard shouldStart else { return }

    startTerminationMonitoring()
    startStandardInputReader()
  }

  /** 将解码与执行一起排入串行链，默认路径时间戳等协议默认值仍在轮到该命令时才计算 */
  private func enqueueCommand(_ line: String) {
    enqueue {
      guard let command = RecorderCommandDecoder.decode(line) else { return }
      await self.coordinator.handle(command)
    }
  }

  /** 经命令链串到在飞命令之后停止录音并退出，重复退出信号幂等忽略 */
  private func finalizeAndExit() {
    let shouldFinalize = commandChainQueue.sync {
      guard !finalizeRequested else { return false }
      finalizeRequested = true
      return true
    }
    guard shouldFinalize else { return }

    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      log("finalize watchdog fired, forcing exit")
      exit(0)
    }

    enqueue {
      await self.coordinator.stop()
      exit(0)
    }
  }

  private func enqueue(_ work: @escaping () async -> Void) {
    commandChainQueue.sync {
      let previous = commandTail
      commandTail = Task {
        await previous.value
        await work()
      }
    }
  }

  private func startTerminationMonitoring() {
    let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    signal(SIGTERM, SIG_IGN)
    signalSource.setEventHandler {
      self.finalizeAndExit()
    }
    signalSource.resume()
    sigTermSource = signalSource

    let parentTimer = DispatchSource.makeTimerSource(queue: .main)
    parentTimer.schedule(deadline: .now() + 3, repeating: 3)
    parentTimer.setEventHandler {
      if getppid() == 1 {
        self.finalizeAndExit()
      }
    }
    parentTimer.resume()
    parentCheckTimer = parentTimer
  }

  private func startStandardInputReader() {
    DispatchQueue.global(qos: .userInitiated).async {
      while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }
        self.enqueueCommand(trimmed)
      }

      /** stdin 关闭表示父进程退出，仍需等待 finishWriting 与混音完成 */
      self.finalizeAndExit()
    }
  }
}
