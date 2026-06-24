#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { getEnv, loadEnv } from '@jl-org/tool/node'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const APP_DIR = resolve(SCRIPT_DIR, '..')
const DEFAULT_DIST_DIR = resolve(APP_DIR, 'dist', 'dist')
const DEFAULT_ENV_DIR = resolve(APP_DIR, 'env')

const { values } = parseArgs({
  options: {
    dir: {
      type: 'string',
      default: DEFAULT_DIST_DIR,
    },
    envDir: {
      type: 'string',
      default: DEFAULT_ENV_DIR,
    },
    envPath: {
      type: 'string',
    },
    project: {
      type: 'string',
    },
    bucket: {
      type: 'string',
    },
    prefix: {
      type: 'string',
    },
    publicBaseUrl: {
      type: 'string',
    },
    dryRun: {
      type: 'boolean',
      default: false,
    },
    skipVerify: {
      type: 'boolean',
      default: false,
    },
  },
  strict: true,
})

loadEnv({
  envDir: resolve(String(values.envDir)),
  envPath: values.envPath
    ? String(values.envPath)
    : undefined,
})

const distDir = resolve(String(values.dir))
const dryRun = Boolean(values.dryRun)
const skipVerify = Boolean(values.skipVerify)
const gcpProject = getCliOrEnv('GCP_PROJECT', values.project, '', true)
const updateBucket = getCliOrEnv('UPDATE_BUCKET', values.bucket, '', true)
const updatePrefix = trimSlashes(getCliOrEnv('UPDATE_PREFIX', values.prefix, 'desktop'))
const gcsBaseUrl = trimEndSlash(getCliOrEnv(
  'GCS_PUBLIC_BASE_URL',
  values.publicBaseUrl,
  `https://storage.googleapis.com/${updateBucket}/${updatePrefix}`,
))
const gcsTarget = `gs://${updateBucket}/${updatePrefix}/`

if (!existsSync(distDir)) {
  console.error(`Update dist directory does not exist: ${distDir}`)
  process.exit(1)
}

const files = readDistFiles(distDir)
const installFiles = files.filter(isVersionedUpdateAsset)
const feedFiles = files.filter(file => /^latest.*\.yml$/.test(file.name))

if (installFiles.length === 0)
  throw new Error(`No update installers or blockmap files found in ${distDir}`)

if (feedFiles.length === 0)
  throw new Error(`No latest*.yml files found in ${distDir}`)

console.log(`GCP project: ${gcpProject}`)
console.log(`GCS target: ${gcsTarget}`)
console.log(`Public base URL: ${gcsBaseUrl}`)
console.log(`Install assets: ${installFiles.length}`)
console.log(`Feed files: ${feedFiles.length}`)

run('gcloud', ['config', 'set', 'project', gcpProject])

console.log('\nChecking bucket config...')
run('gcloud', ['storage', 'buckets', 'describe', `gs://${updateBucket}`])

console.log('\nChecking bucket IAM...')
run('gcloud', ['storage', 'buckets', 'get-iam-policy', `gs://${updateBucket}`])

console.log('\nUploading installers and blockmaps...')
for (const file of installFiles) {
  upload(file.path, 'public, max-age=31536000, immutable')
}

console.log('\nUploading latest*.yml...')
for (const file of feedFiles) {
  upload(file.path, 'no-store', 'text/yaml; charset=utf-8')
}

if (!skipVerify) {
  console.log('\nVerifying public URLs...')
  await verifyHead(`${gcsBaseUrl}/${feedFiles[0].name}`, 200)

  const rangeFile = installFiles.find(file => !file.name.endsWith('.blockmap')) ?? installFiles[0]
  await verifyHead(`${gcsBaseUrl}/${rangeFile.name}`, 206, {
    Range: 'bytes=0-1',
  })
}

console.log('\nGCS update feed upload completed.')

function upload(filePath: string, cacheControl: string, contentType?: string): void {
  const args = [
    'storage',
    'cp',
    filePath,
    gcsTarget,
    `--cache-control=${cacheControl}`,
    ...(contentType
      ? [`--content-type=${contentType}`]
      : []),
  ]

  run('gcloud', args)
}

function run(command: string, args: string[]): void {
  const displayCommand = [command, ...args.map(quoteArg)].join(' ')
  console.log(`$ ${displayCommand}`)

  if (dryRun)
    return

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

async function verifyHead(url: string, expectedStatus: number, headers?: HeadersInit): Promise<void> {
  console.log(`HEAD ${url}`)

  if (dryRun)
    return

  const res = await fetch(url, {
    method: 'HEAD',
    headers,
  })

  const contentRange = res.headers.get('content-range')
  const cacheControl = res.headers.get('cache-control')
  console.log(`status=${res.status}`)
  if (cacheControl)
    console.log(`cache-control=${cacheControl}`)
  if (contentRange)
    console.log(`content-range=${contentRange}`)

  if (res.status !== expectedStatus) {
    throw new Error(`Unexpected status for ${url}. expected=${expectedStatus}, actual=${res.status}`)
  }
}

function readDistFiles(dir: string): DistFile[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => ({
      name: entry.name,
      path: resolve(dir, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function isVersionedUpdateAsset(file: DistFile): boolean {
  if (/^latest.*\.yml$/.test(file.name))
    return false

  return [
    '.zip',
    '.dmg',
    '.exe',
    '.AppImage',
    '.blockmap',
  ].some(ext => file.name.endsWith(ext))
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

function trimEndSlash(value: string): string {
  return value.replace(/\/+$/g, '')
}

function getCliOrEnv(name: string, cliValue: string | boolean | undefined, defaultValue = '', required = false): string {
  if (typeof cliValue === 'string' && cliValue)
    return cliValue

  return getEnv(name, defaultValue, required)
}

function quoteArg(arg: string): string {
  if (/^[\w./:=,@+-]+$/.test(arg))
    return arg

  return JSON.stringify(arg)
}

type DistFile = {
  name: string
  path: string
}
