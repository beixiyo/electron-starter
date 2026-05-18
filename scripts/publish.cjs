// @ts-check
const { deploy } = require('@jl-org/deploy')
const { resolve } = require('node:path')
const { homedir } = require('node:os')
const { readFileSync } = require('node:fs')

/**
 * 命令执行的模式
 * @example node deploy.cjs playground
 */
const mode = process.argv.slice(2)[0] || 'playground'

/**
 * @type {import('@jl-org/deploy').ConnectInfo[]}
 */
const connectInfos = []

if (mode === 'playground') {
  connectInfos.push({
    host: 'xxx.xxx.xxx',
    username: 'xxx',
    privateKey: readFileSync(resolve(homedir(), '.ssh/xxx-stg-key.pem'), 'utf-8'),
    name: 'xxx-playground',
  })
}

const timestamp = Date.now().toString()
/**
 * @type {Record<'playground', Omit<import('@jl-org/deploy').DeployOpts, 'connectInfos'>>}
 */
const config = {
  'playground': {
    buildCmd: 'pnpm build:web',
    distDir: resolve(__dirname, '../packages/electron/out/renderer'),
    zipPath: resolve(__dirname, '../packages/electron/out/renderer/dist.tar.gz'),
    remoteZipPath: `/home/ubuntu/workspace/${timestamp}-dist.tar.gz`,
    remoteUnzipDir: '/home/ubuntu/workspace/playground',
    remoteBackupDir: '/home/ubuntu/workspace/playground-backup',
  },
}

const curConfig = config[mode]
deploy({
  ...curConfig,
  connectInfos,
})
