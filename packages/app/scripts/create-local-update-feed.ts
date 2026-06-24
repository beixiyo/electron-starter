#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..')
const PACKAGE_JSON_PATH = resolve(APP_DIR, 'package.json')
const LATEST_MAC_YML_PATH = resolve(APP_DIR, 'dist', 'dist', 'latest-mac.yml')
const UPDATER_CACHE_DIR = join(homedir(), 'Library', 'Caches', 'electron-app-updater')

const { values } = parseArgs({
  options: {
    version: {
      type: 'string',
    },
    mode: {
      type: 'string',
      default: 'test',
    },
    buildOnly: {
      type: 'boolean',
      default: false,
    },
    /** 构建完成后上传到 GCS（读 env/.env），而不是启动本地服务器 */
    upload: {
      type: 'boolean',
      default: false,
    },
    /** 真实签名 + 公证（用于测「重启并安装」真正替换 App），需要 Apple 公证凭据 */
    notarize: {
      type: 'boolean',
      default: false,
    },
    /** 用本地自签证书（sign:setup）签 feed，免 Apple 公证，本机可测「重启并安装」 */
    selfSign: {
      type: 'boolean',
      default: false,
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
      default: (1024 * 20).toString(),
    },
    payloadKb: {
      type: 'string',
      default: '4096',
    },
    keepCache: {
      type: 'boolean',
      default: false,
    },
  },
  strict: true,
})

const originalPackageText = readFileSync(PACKAGE_JSON_PATH, 'utf8')
const packageJson = JSON.parse(originalPackageText) as AppPackageJson
const currentVersion = assertVersion(packageJson.version, 'package.json version')
const existingFeedVersion = readExistingFeedVersion()
const targetVersion = values.version
  ? assertVersion(values.version, '--version')
  : nextPatchVersion(maxVersion([currentVersion, existingFeedVersion].filter(Boolean) as string[]))

if (compareVersions(targetVersion, currentVersion) <= 0) {
  throw new Error(`Local update version must be higher than package.json version. current=${currentVersion}, target=${targetVersion}`)
}

let packageRestored = false

/**
 * 构建失败时 run() 走 process.exit()，不会触发下面的 try/finally，
 * 用 exit 事件兜底还原 package.json（writeFileSync 同步，exit 回调里可用）
 */
process.once('exit', () => {
  restorePackageJson()
})

process.once('SIGINT', () => {
  restorePackageJson()
  process.exit(130)
})

process.once('SIGTERM', () => {
  restorePackageJson()
  process.exit(143)
})

try {
  console.log(`Creating local macOS update feed: ${currentVersion} -> ${targetVersion}`)
  clearUpdaterCache()
  writePackageVersion(targetVersion)

  /**
   * 签名档位三选一：
   * - selfSign：自签证书签 feed（本机测重启安装，免 Apple）
   * - notarize：真实签名 + 公证（identity 走钥匙串 / yml）
   * - 都不传：--localUpdate ad-hoc（只够测检查 / 下载 / 进度）
   */
  const signFlags = values.selfSign
    ? ['--selfSign']
    : values.notarize
      ? []
      : ['--localUpdate']

  run('node', [
    './scripts/build-for.mjs',
    '--platform=mac',
    `--mode=${values.mode}`,
    ...signFlags,
    `--localUpdatePayloadKb=${values.payloadKb}`,
  ])
}
finally {
  restorePackageJson()
}

assertGeneratedFeed(targetVersion)

if (values.upload) {
  /** 上传到 GCS，地址与凭据来自 env/.env（GCP_PROJECT / UPDATE_BUCKET / ...） */
  run('bun', ['./scripts/upload-gcs-update-feed.ts'])
}
else if (!values.buildOnly) {
  run('bun', [
    './scripts/serve-update-feed.ts',
    `--host=${values.host}`,
    `--port=${values.port}`,
    `--rateKbps=${values.rateKbps}`,
  ])
}

function writePackageVersion(version: string): void {
  const nextPackageJson = {
    ...packageJson,
    version,
  }

  writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(nextPackageJson, null, 2)}\n`)
}

function restorePackageJson(): void {
  if (packageRestored)
    return

  writeFileSync(PACKAGE_JSON_PATH, originalPackageText)
  packageRestored = true
}

function clearUpdaterCache(): void {
  if (values.keepCache)
    return

  rmSync(UPDATER_CACHE_DIR, { force: true, recursive: true })
  console.log(`Cleared updater cache: ${UPDATER_CACHE_DIR}`)
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: APP_DIR,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error)
    throw result.error

  if (result.status !== 0)
    process.exit(result.status ?? 1)
}

function readExistingFeedVersion(): string | null {
  if (!existsSync(LATEST_MAC_YML_PATH))
    return null

  const feedText = readFileSync(LATEST_MAC_YML_PATH, 'utf8')
  return feedText.match(/^version:\s*['"]?([^'"\s]+)/m)?.[1] ?? null
}

function assertGeneratedFeed(version: string): void {
  if (!existsSync(LATEST_MAC_YML_PATH)) {
    throw new Error(`latest-mac.yml was not generated: ${LATEST_MAC_YML_PATH}`)
  }

  const feedText = readFileSync(LATEST_MAC_YML_PATH, 'utf8')
  const feedVersion = feedText.match(/^version:\s*['"]?([^'"\s]+)/m)?.[1]
  const feedPath = feedText.match(/^path:\s*['"]?([^'"\s]+)/m)?.[1]

  if (feedVersion !== version) {
    throw new Error(`latest-mac.yml version mismatch. expected=${version}, actual=${feedVersion ?? 'missing'}`)
  }

  if (feedPath && !feedPath.includes(version)) {
    throw new Error(`latest-mac.yml points to "${feedPath}", which does not include version ${version}. Rebuild the feed instead of editing yml by hand.`)
  }
}

function assertVersion(version: string | undefined, label: string): string {
  if (!version || !parseVersion(version)) {
    throw new Error(`${label} must be a semver-like x.y.z version, got: ${version ?? 'missing'}`)
  }

  return version
}

function maxVersion(versions: string[]): string {
  return versions.reduce((max, version) => (
    compareVersions(version, max) > 0
      ? version
      : max
  ))
}

function nextPatchVersion(version: string): string {
  const parsed = parseVersion(version)
  if (!parsed)
    throw new Error(`Cannot bump version: ${version}`)

  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)

  if (!leftVersion || !rightVersion)
    throw new Error(`Cannot compare versions: ${left}, ${right}`)

  return leftVersion.major - rightVersion.major
    || leftVersion.minor - rightVersion.minor
    || leftVersion.patch - rightVersion.patch
}

function parseVersion(version: string): VersionParts | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match)
    return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

type AppPackageJson = {
  version?: string
  [key: string]: unknown
}

type VersionParts = {
  major: number
  minor: number
  patch: number
}
