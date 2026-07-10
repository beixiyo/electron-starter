import { desktopCapturer, session } from 'electron'
import { createMainDiagnosticLogger } from '../logging'

const log = createMainDiagnosticLogger('screenshot')

/**
 * 注册 getDisplayMedia 请求处理器
 *
 * Electron 默认不实现 `navigator.mediaDevices.getDisplayMedia`，渲染进程直接调用会抛
 * 「Not supported」。这里统一接管：授予首个屏幕，并在请求音频时返回 `loopback` 系统音频
 *
 * - 系统音频（loopback）依赖 Chromium 的 CoreAudio Tap / ScreenCaptureKit 能力，
 *   需配合 main 入口处的 `enable-features` 开关与 Info.plist 的
 *   `NSAudioCaptureUsageDescription` 一同启用（见 main/index.ts）
 * - 不使用 `useSystemPicker`：原生系统选择器只共享窗口/屏幕，无法稳定捕获系统音频
 * - macOS 上捕获屏幕仍需「屏幕录制」权限；授权后通常需重启 App 生效
 *
 * @see https://www.electronjs.org/docs/latest/api/desktop-capturer
 */
export function setupDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        const source = sources[0]
        if (!source) {
          /** 没有可用屏幕源，拒绝请求 */
          callback({})
          return
        }

        callback({
          video: source,
          /** 请求音频时返回系统音频回环（macOS / Windows / PulseAudio Linux） */
          ...(request.audioRequested
            ? { audio: 'loopback' }
            : {}),
        })
      })
      .catch((error) => {
        log.error('display-media.request-failed', 'failed to handle getDisplayMedia request', error)
        callback({})
      })
  })
}
