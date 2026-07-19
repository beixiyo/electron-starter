#!/usr/bin/env bun
import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..')
const DEFAULT_DIR = resolve(APP_DIR, 'dist', 'dist')
const CHUNK_SIZE = 64 * 1024

const { values } = parseArgs({
  options: {
    dir: {
      type: 'string',
      default: DEFAULT_DIR,
    },
    host: {
      type: 'string',
      default: '127.0.0.1',
    },
    port: {
      type: 'string',
      default: '8788',
    },
    rateKbps: {
      type: 'string',
      default: '0',
    },
  },
  strict: true,
})

const rootDir = resolve(String(values.dir))
const host = String(values.host)
const port = Number(values.port)
const rateKbps = Number(values.rateKbps)
const bytesPerSecond = Number.isFinite(rateKbps) && rateKbps > 0
  ? rateKbps * 1024
  : 0

if (!existsSync(rootDir)) {
  console.error(`Update feed directory does not exist: ${rootDir}`)
  process.exit(1)
}

printFeedStatus()

Bun.serve({
  hostname: host,
  port,
  async fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: baseHeaders(),
      })
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: baseHeaders(),
      })
    }

    const filePath = resolveRequestPath(req.url)
    if (!filePath)
      return new Response('Forbidden', { status: 403, headers: baseHeaders() })

    if (!existsSync(filePath))
      return new Response('Not Found', { status: 404, headers: baseHeaders() })

    const stat = statSync(filePath)
    if (stat.isDirectory())
      return directoryResponse(req.url, filePath)

    return fileResponse(req, filePath, stat.size)
  },
})

console.log(`Update feed server: http://${host}:${port}`)
console.log(`Serving: ${rootDir}`)
if (bytesPerSecond > 0)
  console.log(`Download throttle: ${rateKbps} KB/s`)

function resolveRequestPath(url: string): string | null {
  const { pathname } = new URL(url)
  const decodedPath = decodeURIComponent(pathname)
  const filePath = resolve(rootDir, `.${decodedPath}`)
  const rootPrefix = rootDir.endsWith(sep)
    ? rootDir
    : `${rootDir}${sep}`

  if (filePath !== rootDir && !filePath.startsWith(rootPrefix))
    return null

  return filePath
}

function directoryResponse(url: string, dir: string): Response {
  const { pathname } = new URL(url)
  const links = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const suffix = entry.isDirectory()
        ? '/'
        : ''
      const href = `${pathname.replace(/\/?$/, '/')}${encodeURIComponent(entry.name)}${suffix}`
      return `<li><a href="${href}">${escapeHtml(entry.name)}${suffix}</a></li>`
    })
    .join('\n')

  return new Response(`<!doctype html>
<meta charset="utf-8">
<title>Update Feed</title>
<h1>Update Feed</h1>
<p>${escapeHtml(relative(process.cwd(), dir) || dir)}</p>
<ul>${links}</ul>`, {
    headers: {
      ...baseHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

function fileResponse(req: Request, filePath: string, size: number): Response {
  const range = req.headers.get('range')
  const rangeResult = parseRange(range, size)

  if (rangeResult === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: {
        ...fileHeaders(filePath),
        'Content-Range': `bytes */${size}`,
      },
    })
  }

  const { start, end, partial } = rangeResult
  const contentLength = end - start + 1
  const body = req.method === 'HEAD'
    ? null
    : bytesPerSecond > 0
      ? createThrottledFileStream(filePath, start, end, bytesPerSecond)
      : Bun.file(filePath).slice(start, end + 1)

  return new Response(body, {
    status: partial
      ? 206
      : 200,
    headers: {
      ...fileHeaders(filePath),
      'Content-Length': String(contentLength),
      ...(partial
        ? { 'Content-Range': `bytes ${start}-${end}/${size}` }
        : {}),
    },
  })
}

function parseRange(range: string | null, size: number): RangeResult | 'invalid' {
  if (!range) {
    return {
      start: 0,
      end: Math.max(size - 1, 0),
      partial: false,
    }
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/)
  if (!match)
    return 'invalid'

  const [, rawStart, rawEnd] = match
  let start = rawStart
    ? Number(rawStart)
    : 0
  let end = rawEnd
    ? Number(rawEnd)
    : size - 1

  if (!rawStart && rawEnd) {
    const suffixLength = Number(rawEnd)
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
    return 'invalid'

  return {
    start,
    end: Math.min(end, size - 1),
    partial: true,
  }
}

function createThrottledFileStream(
  filePath: string,
  start: number,
  end: number,
  limitBytesPerSecond: number,
): ReadableStream<Uint8Array> {
  let offset = start

  return new ReadableStream({
    async pull(controller) {
      if (offset > end) {
        controller.close()
        return
      }

      const chunkEnd = Math.min(offset + CHUNK_SIZE - 1, end)
      const buffer = await Bun.file(filePath).slice(offset, chunkEnd + 1).arrayBuffer()
      const chunk = new Uint8Array(buffer)

      controller.enqueue(chunk)
      offset = chunkEnd + 1

      await Bun.sleep((chunk.byteLength / limitBytesPerSecond) * 1000)
    },
  })
}

function fileHeaders(filePath: string): Record<string, string> {
  const name = filePath.split(sep).at(-1) ?? ''

  return {
    ...baseHeaders(),
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType(filePath),
    'Cache-Control': name.startsWith('latest') && name.endsWith('.yml')
      ? 'no-store'
      : 'public, max-age=31536000, immutable',
  }
}

function baseHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  }
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.yml':
    case '.yaml':
      return 'text/yaml; charset=utf-8'
    case '.zip':
      return 'application/zip'
    case '.dmg':
    case '.blockmap':
    case '.AppImage':
      return 'application/octet-stream'
    case '.exe':
      return 'application/vnd.microsoft.portable-executable'
    default:
      return 'application/octet-stream'
  }
}

function printFeedStatus(): void {
  const files = readdirSync(rootDir)
  const channels = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']
  const availableChannels = channels.filter(channel => files.includes(channel))

  if (availableChannels.length === 0) {
    console.warn('No latest*.yml found. Build a release package before checking updates.')
    return
  }

  console.log(`Channels: ${availableChannels.join(', ')}`)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

type RangeResult = {
  start: number
  end: number
  partial: boolean
}
