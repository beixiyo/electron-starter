/** 确保新 worktree 在 Electron dev 启动前具备被 Git 忽略的 macOS 原生构建产物 */

import { execFileSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'darwin') {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const appDir = path.resolve(scriptDir, '..')
  const outputDir = path.join(appDir, 'resources', 'native', 'mac')
  const requiredBinaries = [
    'focus-check',
    'keyboard-listener',
    'settings-window',
    'insert-text',
    'hour-cycle',
    'audio-monitor',
    'audio-recorder',
    'screenshot-capture',
  ]
  const missing = requiredBinaries.filter((binary) => {
    try {
      const binaryPath = path.join(outputDir, binary)
      accessSync(binaryPath, constants.X_OK)
      return !statSync(binaryPath).isFile()
    }
    catch {
      return true
    }
  })

  if (missing.length > 0) {
    console.log(`Missing macOS native helpers: ${missing.join(', ')}`)
    console.log('Building native helpers before Electron dev startup...')
    execFileSync('bash', [path.join(scriptDir, 'build-native.sh'), '--platform=mac'], {
      stdio: 'inherit',
    })
  }
}
