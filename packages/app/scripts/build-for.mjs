#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadEnv } from '@jl-org/tool/node'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '../../..')
const appDir = resolve(__dirname, '..')
const deployDir = resolve(__dirname, '../dist')
const electronBuilderBin = resolve(__dirname, '../node_modules/.bin/electron-builder')
const packageFilter = process.env.PACKAGE_FILTER || 'app'
const timestampCheckTempPrefix = process.env.TIMESTAMP_CHECK_TEMP_PREFIX || 'electron-codesign-check-'

const execOpts = {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { NODE_ENV: 'production', ...process.env },
}

/** 解析命令行参数 */
const options = {
  platform: {
    type: 'string',
    default: 'dir',
    short: 'p',
    description: 'Target platform (win, mac, linux, dir)',
  },
  mode: {
    type: 'string',
    default: 'production',
    short: 'm',
    description: 'Build mode (development, test, prev, production)',
  },
  skipBuild: {
    type: 'boolean',
    default: false,
    short: 's',
    description: 'Skip build and prepare steps',
  },
  localUpdate: {
    type: 'boolean',
    default: false,
    description: 'Build a local auto-update feed without macOS notarization',
  },
  localUpdatePayloadKb: {
    type: 'string',
    default: '0',
    description: 'Write a random payload into local update builds so differential progress is visible',
  },
  selfSign: {
    type: 'boolean',
    default: false,
    description: 'Sign the macOS feed with the local self-signed identity (sign:setup) instead of Apple notarization — same-machine restart-and-install test',
  },
}

const { values: args } = parseArgs({ options, strict: true })

/**
 * 按构建模式加载更新发布环境变量（注入 publish.url 用）：
 * build:mac:test 读 env/.env.test、build:mac:prod 读 env/.env.production。
 * 缺对应文件时静默跳过，回退到 electron-builder.yml 的兜底 url
 */
loadEnv({ envDir: resolve(appDir, 'env'), envPath: `.env.${args.mode}` })

/** 自签证书名，与 selfsign-app.ts 保持一致 */
const SELF_SIGN_IDENTITY = process.env.SIGN_CERT_NAME || 'Local CodeSign'

/** localUpdate 与 selfSign 都属于「免 Apple 公证」的本地更新构建 */
const isLocalFeedBuild = args.localUpdate || args.selfSign

console.log(`Building for platform: ${args.platform}, mode: ${args.mode}, localUpdate: ${args.localUpdate}, selfSign: ${args.selfSign}`)

try {
  if (args.platform === 'mac' && !isLocalFeedBuild) {
    verifyMacNotarizationCredentials()
    await verifyAppleTimestampService()
  }

  // 1. 清理部署目录
  console.log('Cleaning deployment directory...')
  if (existsSync(deployDir)) {
    await rm(deployDir, { recursive: true, force: true })
  }
  await mkdir(deployDir, { recursive: true })

  // 2. 执行构建和准备（除非跳过）
  if (!args.skipBuild) {
    /** 仅 mac 目标才编 swift 原生二进制（swift 只能在 macOS 编， */
    const needsNative = args.platform === 'mac'
      || (args.platform === 'dir' && process.platform === 'darwin')
    if (needsNative) {
      console.log('Building native (swift) binaries...')
      execSync(`pnpm -F ${packageFilter} build:native:mac`, execOpts)
    }

    console.log('Running build...')
    execSync(`pnpm -F ${packageFilter} build --mode ${args.mode}`, execOpts)
    await writeLocalUpdatePayload()

    console.log('Preparing deployment...')
    /** 部署包 */
    execSync(
      `pnpm -F ${packageFilter} deploy --prod --ignore-scripts "${deployDir}"`,
      execOpts,
    )
  }
  else {
    console.log('Skipping build and prepare steps (using --skipBuild)')
  }

  // 3. 验证部署目录是否已正确生成
  try {
    await access(join(deployDir, 'package.json'))
  }
  catch {
    console.error('❌ Deployment directory not properly prepared. Missing package.json')
    process.exit(1)
  }

  // 4. 执行平台特定构建
  console.log(`Building for ${args.platform} platform...`)
  const platformFlag = args.platform === 'dir'
    ? '--dir'
    : `--${args.platform}`
  const configOverrides = [
    ...getPublishOverrides(),
    ...getTestArtifactNameOverrides(),
    ...getElectronBuilderConfigOverrides(),
  ]

  execSync(
    `"${electronBuilderBin}" --projectDir "${deployDir}" ${platformFlag} ${configOverrides.join(' ')}`,
    { ...execOpts, cwd: deployDir },
  )

  await notarizeMacDistributionArtifacts()
  await cleanupMacIntermediateApps()

  console.log('✅ Build completed successfully')
}
catch (error) {
  console.error('❌ Build failed:', error.message)
  process.exit(1)
}

async function writeLocalUpdatePayload() {
  /**
   * 与 --localUpdate 解耦：只要显式传了正数 payloadKb 就写随机内容，
   * 这样签名公证的真实更新包也能制造相邻版本差异，模拟增量下载
   */
  const payloadKb = Number(args.localUpdatePayloadKb)
  if (!Number.isFinite(payloadKb) || payloadKb <= 0)
    return

  const payloadBytes = Math.round(payloadKb * 1024)
  const payloadPath = join(appDir, 'out', 'local-update-payload.bin')

  console.log(`Writing local update payload: ${payloadKb} KB`)
  await writeFile(payloadPath, randomBytes(payloadBytes))
}

async function verifyAppleTimestampService() {
  if (process.platform !== 'darwin') {
    return
  }

  const identity = findDeveloperIdIdentity()
  if (!identity) {
    return
  }

  const tempDir = await mkdtemp(join(tmpdir(), timestampCheckTempPrefix))
  const tempBin = join(tempDir, 'echo')

  try {
    await copyFile('/bin/echo', tempBin)
    execSync(
      `codesign --sign "${identity}" --force --timestamp --options runtime "${tempBin}"`,
      { ...execOpts, stdio: 'pipe' },
    )
  }
  catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    throw new Error([
      'Apple timestamp service is unavailable, macOS notarization builds cannot continue.',
      output,
      'This is a network issue before notarization upload. Check DNS first: public DNS such as 8.8.8.8 may bypass a company gateway fake-ip DNS for timestamp.apple.com.',
    ].filter(Boolean).join('\n'))
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function findDeveloperIdIdentity() {
  const output = execSync('security find-identity -v -p codesigning', {
    ...execOpts,
    stdio: 'pipe',
    encoding: 'utf8',
  })

  return output
    .split('\n')
    .map(line => line.match(/"([^"]*Developer ID Application:[^"]+)"/)?.[1])
    .find(Boolean)
}

/**
 * 把更新发布地址注入安装包：electron-builder 会据此生成 app-update.yml，
 * 客户端只认这个烧进去的地址。取值优先级（与 upload-gcs 脚本保持一致）：
 *   UPDATE_PUBLISH_URL > GCS_PUBLIC_BASE_URL > 由 UPDATE_BUCKET/UPDATE_PREFIX 推导
 * 都没有则沿用 electron-builder.yml 里的 publish.url（CLI -c 覆盖优先级高于 yml）
 */
function getPublishOverrides() {
  const publishUrl = process.env.UPDATE_PUBLISH_URL
    || process.env.GCS_PUBLIC_BASE_URL
    || deriveGcsBaseUrl()
  if (!publishUrl)
    return []

  console.log(`Overriding publish.url -> ${publishUrl}`)
  return [`-c.publish.url=${publishUrl}`]
}

/** 仅有 UPDATE_BUCKET（+可选 UPDATE_PREFIX）时，推导出 GCS 公开地址 */
function deriveGcsBaseUrl() {
  const bucket = process.env.UPDATE_BUCKET
  if (!bucket)
    return ''

  const prefix = (process.env.UPDATE_PREFIX || 'desktop').replace(/^\/+|\/+$/g, '')
  return prefix
    ? `https://storage.googleapis.com/${bucket}/${prefix}`
    : `https://storage.googleapis.com/${bucket}`
}

function getElectronBuilderConfigOverrides() {
  if (process.platform !== 'darwin') {
    return []
  }

  /**
   * 自签 feed：用本地自签证书（sign:setup 生成）在构建期签进 zip，跳过 Apple 公证
   * 新旧版本用同一证书 → Squirrel 校验签名连续性通过 → 本机可测「重启并安装」
   * 证书名含空格，必须加引号，否则拼进命令行会被拆成两个参数
   */
  if (args.platform === 'mac' && args.selfSign) {
    return [
      `-c.mac.identity="${SELF_SIGN_IDENTITY}"`,
      '-c.mac.notarize=false',
      '-c.mac.forceCodeSigning=true',
    ]
  }

  /** dir 解包 / 本地 ad-hoc feed：不签名（仅下载联调，或交给 selfsign-app.ts 事后签） */
  if (args.platform === 'dir' || (args.platform === 'mac' && args.localUpdate)) {
    return [
      '-c.mac.identity=null',
      '-c.mac.notarize=false',
      '-c.mac.forceCodeSigning=false',
    ]
  }

  return []
}

/** 测试环境产物名显式带 test，避免与生产安装包混淆；feed 会同步引用这些文件名 */
function getTestArtifactNameOverrides() {
  if (args.mode !== 'test')
    return []

  // electron-builder 的文件名宏，不是 JS 模板字符串
  // eslint-disable-next-line no-template-curly-in-string
  const artifactName = '${name}-test-${version}.${ext}'

  switch (args.platform) {
    case 'mac':
      return [
        `'-c.mac.artifactName=${artifactName}'`,
        `'-c.dmg.artifactName=${artifactName}'`,
      ]
    case 'win':
      return [`'-c.nsis.artifactName=${artifactName}'`]
    case 'linux':
      return [
        `'-c.appImage.artifactName=${artifactName}'`,
        `'-c.deb.artifactName=${artifactName}'`,
        `'-c.snap.artifactName=${artifactName}'`,
      ]
    default:
      return []
  }
}

function verifyMacNotarizationCredentials() {
  if (process.platform !== 'darwin') {
    return
  }

  getNotaryCredentialsArgs()
}

async function cleanupMacIntermediateApps() {
  if (args.platform !== 'mac') {
    return
  }

  const builderOutDir = join(deployDir, 'dist')
  if (!existsSync(builderOutDir)) {
    return
  }

  const entries = await readdir(builderOutDir, { withFileTypes: true })
  const macOutputDirs = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mac'))
    .map(entry => join(builderOutDir, entry.name))

  for (const macOutputDir of macOutputDirs) {
    const appEntries = await readdir(macOutputDir, { withFileTypes: true })
    const appDirs = appEntries
      .filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
      .map(entry => join(macOutputDir, entry.name))

    for (const appDir of appDirs) {
      console.log(`Cleaning macOS intermediate app: ${appDir}`)
      await rm(appDir, { recursive: true, force: true })
    }

    const remainingEntries = await readdir(macOutputDir)
    if (remainingEntries.length === 0) {
      await rm(macOutputDir, { recursive: true, force: true })
    }
  }
}

async function notarizeMacDistributionArtifacts() {
  if (args.platform !== 'mac' || isLocalFeedBuild) {
    return
  }

  const builderOutDir = join(deployDir, 'dist')
  if (!existsSync(builderOutDir)) {
    return
  }

  const entries = await readdir(builderOutDir, { withFileTypes: true })
  const dmgFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.dmg'))
    .map(entry => join(builderOutDir, entry.name))

  for (const dmgFile of dmgFiles) {
    if (hasStapledTicket(dmgFile)) {
      console.log(`macOS notarization ticket already stapled: ${dmgFile}`)
      continue
    }

    console.log(`Notarizing macOS distribution artifact: ${dmgFile}`)
    execSync(
      `xcrun notarytool submit "${dmgFile}" ${getNotaryCredentialsArgs()} --wait`,
      execOpts,
    )

    execSync(`xcrun stapler staple "${dmgFile}"`, execOpts)
    execSync(`xcrun stapler validate "${dmgFile}"`, execOpts)
  }
}

function hasStapledTicket(file) {
  try {
    execSync(`xcrun stapler validate "${file}"`, {
      ...execOpts,
      stdio: 'pipe',
    })
    return true
  }
  catch {
    return false
  }
}

function getNotaryCredentialsArgs() {
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env
  if (APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER) {
    return [
      `--key "${APPLE_API_KEY}"`,
      `--key-id "${APPLE_API_KEY_ID}"`,
      `--issuer "${APPLE_API_ISSUER}"`,
    ].join(' ')
  }

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    return [
      `--apple-id "${APPLE_ID}"`,
      `--password "${APPLE_APP_SPECIFIC_PASSWORD}"`,
      `--team-id "${APPLE_TEAM_ID}"`,
    ].join(' ')
  }

  throw new Error([
    'macOS notarization credentials are missing.',
    'Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.',
  ].join('\n'))
}
