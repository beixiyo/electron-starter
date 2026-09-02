/** 屏幕原图捕获后端：macOS 使用 ScreenCaptureKit，其他平台回退 Electron */

import { execFile, spawn } from 'node:child_process'
import { desktopCapturer } from 'electron'
import { createMainDiagnosticLogger } from './logging'
import { getNativeBinaryPath } from './native-bridge'
import { NativeCaptureStreamParser } from './screenshot-capture-protocol'

const diagnosticLog = createMainDiagnosticLogger('screenshot')
const NATIVE_CAPTURE_TIMEOUT_MS = 10_000
const NATIVE_CAPTURE_MAX_STDERR_BYTES = 1024 * 1024
let nativeWarmupPromise: Promise<void> | null = null

/**
 * 捕获所有显示器的无损 PNG 原图
 *
 * macOS 优先使用 ScreenCaptureKit 单帧 API，避免 desktopCapturer 为每个 source
 * 生成并缩放 NativeImage 缩略图。原生 helper 不可用时保留 Electron 回退，确保开发环境
 * 未编译 helper 或原生捕获异常时截图功能仍可用。
 */
export async function captureAllDisplays(
  displays: Electron.Display[],
  options: CaptureAllDisplaysOptions = {},
): Promise<DisplayCapture[]> {
  throwIfAborted(options.signal)

  if (process.platform === 'darwin') {
    const startedAt = Date.now()
    try {
      const captures = await captureWithMacScreenCaptureKit(displays, options.signal)
      diagnosticLog.info('native.completed', 'native display capture completed', {
        displayCount: captures.length,
        durationMs: Date.now() - startedAt,
      })
      return captures
    }
    catch (error) {
      throwIfAborted(options.signal)
      diagnosticLog.warn('native.fallback', 'native display capture failed; falling back to Electron', {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error
          ? error.message
          : String(error),
      })
    }
  }

  return captureWithElectron(displays, options.signal)
}

/**
 * 预热 macOS ScreenCaptureKit 服务，不抓取或返回任何屏幕图像
 *
 * 仅应在调用方确认已有屏幕录制权限后执行，避免应用启动时主动触发权限提示。
 */
export function warmMacScreenshotCapture(): Promise<void> {
  if (process.platform !== 'darwin')
    return Promise.resolve()
  if (nativeWarmupPromise)
    return nativeWarmupPromise

  const startedAt = Date.now()
  nativeWarmupPromise = executeNativeWarmup()
    .then(() => {
      diagnosticLog.info('native.warmed', 'native screenshot service warmed', {
        durationMs: Date.now() - startedAt,
      })
    })
    .catch((error) => {
      nativeWarmupPromise = null
      throw error
    })
  return nativeWarmupPromise
}

async function captureWithMacScreenCaptureKit(
  displays: Electron.Display[],
  signal?: AbortSignal,
): Promise<DisplayCapture[]> {
  if (nativeWarmupPromise)
    await nativeWarmupPromise.catch(() => {})
  throwIfAborted(signal)

  const captures = await executeNativeCapture(
    displays.map(display => display.id),
    signal,
  )
  const capturesByDisplayId = new Map(captures.map(capture => [capture.displayId, capture]))

  return displays.map((display) => {
    const capture = capturesByDisplayId.get(display.id)
    if (!capture)
      throw new Error(`Native screenshot missing display ${display.id}`)

    return {
      displayId: display.id,
      bounds: display.bounds,
      scaleX: capture.width / display.bounds.width,
      scaleY: capture.height / display.bounds.height,
      pngBuffer: capture.pngBuffer,
    }
  })
}

function executeNativeWarmup(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      getNativeBinaryPath('screenshot-capture'),
      ['--warmup'],
      {
        encoding: 'buffer',
        maxBuffer: NATIVE_CAPTURE_MAX_STDERR_BYTES,
        timeout: NATIVE_CAPTURE_TIMEOUT_MS,
      },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = Buffer.isBuffer(stderr)
            ? stderr.toString('utf8').trim()
            : String(stderr).trim()
          reject(new Error(detail || error.message, { cause: error }))
          return
        }

        resolve()
      },
    )
  })
}

function executeNativeCapture(
  displayIds: number[],
  signal?: AbortSignal,
): Promise<ReturnType<NativeCaptureStreamParser['finish']>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortError(signal))
      return
    }

    const parser = new NativeCaptureStreamParser(displayIds)
    const child = spawn(
      getNativeBinaryPath('screenshot-capture'),
      displayIds.map(String),
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let settled = false
    let stderr = ''

    const finish = (error?: unknown) => {
      if (settled)
        return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)

      if (error)
        reject(error)
      else {
        try {
          resolve(parser.finish())
        }
        catch (parseError) {
          reject(parseError)
        }
      }
    }
    const handleAbort = () => {
      child.kill('SIGKILL')
      finish(getAbortError(signal))
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`Native screenshot helper timed out after ${NATIVE_CAPTURE_TIMEOUT_MS}ms`))
    }, NATIVE_CAPTURE_TIMEOUT_MS)

    signal?.addEventListener('abort', handleAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled)
        return
      try {
        parser.push(chunk)
      }
      catch (error) {
        child.kill('SIGKILL')
        finish(error)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length >= NATIVE_CAPTURE_MAX_STDERR_BYTES)
        return
      stderr += chunk.slice(0, NATIVE_CAPTURE_MAX_STDERR_BYTES - stderr.length)
    })
    child.once('error', finish)
    child.once('close', (code, childSignal) => {
      if (settled)
        return
      if (code !== 0) {
        finish(new Error(
          stderr.trim()
          || `Native screenshot helper exited with code ${code ?? 'null'} (${childSignal ?? 'no signal'})`,
        ))
        return
      }

      finish()
    })
  })
}

async function captureWithElectron(
  displays: Electron.Display[],
  signal?: AbortSignal,
): Promise<DisplayCapture[]> {
  const startedAt = Date.now()
  throwIfAborted(signal)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: getMaxDisplayThumbnailSize(displays),
    fetchWindowIcons: false,
  })
  throwIfAborted(signal)
  const allowIndexedFallback = canUseIndexedScreenFallback(sources, displays)

  const captures = displays.map((display, index) => {
    const source = findScreenSource(sources, display, allowIndexedFallback, index)
    if (!source || source.thumbnail.isEmpty())
      throw new Error(`No screenshot source found for display ${display.id}`)

    /** NativeImage 可能同时持有 @1x / @2x；显式选择最高倍率，避免默认 @1x 降质 */
    const representationScaleFactor = Math.max(1, ...source.thumbnail.getScaleFactors())
    const imageSize = source.thumbnail.getSize(representationScaleFactor)
    const pixelWidth = imageSize.width * representationScaleFactor
    const pixelHeight = imageSize.height * representationScaleFactor
    return {
      displayId: display.id,
      bounds: display.bounds,
      scaleX: pixelWidth / display.bounds.width,
      scaleY: pixelHeight / display.bounds.height,
      pngBuffer: source.thumbnail.toPNG({ scaleFactor: representationScaleFactor }),
    }
  })

  diagnosticLog.info('electron.completed', 'Electron display capture completed', {
    displayCount: captures.length,
    durationMs: Date.now() - startedAt,
  })
  return captures
}

function findScreenSource(
  sources: Electron.DesktopCapturerSource[],
  display: Electron.Display,
  allowIndexedFallback: boolean,
  index: number,
): Electron.DesktopCapturerSource | undefined {
  return sources.find(source => Number(source.display_id) === display.id)
    ?? (allowIndexedFallback
      ? sources[index]
      : undefined)
}

/** 请求覆盖所有显示器物理分辨率的最大缩略图，避免 Retina 被默认 150x150 降采样 */
function getMaxDisplayThumbnailSize(displays: Electron.Display[]): Electron.Size {
  return displays.reduce<Electron.Size>(
    (maxSize, display) => ({
      width: Math.max(maxSize.width, Math.ceil(display.bounds.width * display.scaleFactor)),
      height: Math.max(maxSize.height, Math.ceil(display.bounds.height * display.scaleFactor)),
    }),
    { width: 0, height: 0 },
  )
}

/** display_id 缺失时只有单屏按索引匹配是无歧义的，多屏宁可失败也不交付错屏 */
function canUseIndexedScreenFallback(
  sources: Electron.DesktopCapturerSource[],
  displays: Electron.Display[],
): boolean {
  if (displays.length !== 1 || sources.length !== 1)
    return false

  const displayId = Number(sources[0]?.display_id)
  return !Number.isFinite(displayId) || displayId <= 0
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw getAbortError(signal)
}

function getAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error)
    return signal.reason

  const error = new Error('Screenshot capture aborted')
  error.name = 'AbortError'
  return error
}

export type DisplayCapture = {
  displayId: number
  bounds: Electron.Rectangle
  scaleX: number
  scaleY: number
  pngBuffer: Buffer
}

export type CaptureAllDisplaysOptions = {
  /** 会话作废时终止原生 helper；Electron fallback 会在系统调用返回后丢弃结果 */
  signal?: AbortSignal
}
