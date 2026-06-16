#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '../../..')
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
}

const { values: args } = parseArgs({ options, strict: true })

console.log(`Building for platform: ${args.platform}, mode: ${args.mode}`)

try {
  if (args.platform === 'mac') {
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
    // 仅 mac 目标才编 swift 原生二进制（swift 只能在 macOS 编，
    const needsNative = args.platform === 'mac'
      || (args.platform === 'dir' && process.platform === 'darwin')
    if (needsNative) {
      console.log('Building native (swift) binaries...')
      execSync(`pnpm -F ${packageFilter} build:native`, execOpts)
    }

    console.log('Running build...')
    execSync(`pnpm -F ${packageFilter} build --mode ${args.mode}`, execOpts)

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
  const configOverrides = getElectronBuilderConfigOverrides()

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

function getElectronBuilderConfigOverrides() {
  if (args.platform !== 'dir' || process.platform !== 'darwin') {
    return []
  }

  return [
    '-c.mac.identity=null',
    '-c.mac.notarize=false',
    '-c.mac.forceCodeSigning=false',
  ]
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
  if (args.platform !== 'mac') {
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
