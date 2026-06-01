#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '../../..')
const deployDir = resolve(__dirname, '../dist')
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
    description: 'Build mode (development, test, production)',
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
  // 1. 清理部署目录
  console.log('Cleaning deployment directory...')
  if (existsSync(deployDir)) {
    await rm(deployDir, { recursive: true, force: true })
  }
  await mkdir(deployDir, { recursive: true })

  // 2. 执行构建和准备（除非跳过）
  if (!args.skipBuild) {
    console.log('Running build...')
    execSync(`pnpm -F app build --mode ${args.mode}`, execOpts)

    console.log('Preparing deployment...')
    /** 部署包 */
    execSync(
      `pnpm -F app deploy --prod --ignore-scripts "${deployDir}"`,
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

  execSync(
    `pnpm exec electron-builder --projectDir "${deployDir}" ${platformFlag}`,
    execOpts,
  )

  console.log('✅ Build completed successfully')
}
catch (error) {
  console.error('❌ Build failed:', error.message)
  process.exit(1)
}
