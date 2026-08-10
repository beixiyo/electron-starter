/** Electron 快捷键与 IPC 测试的模块解析配置 */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './renderer'),
      '@main': resolve(__dirname, './main'),
      '@shared': resolve(__dirname, './shared'),
      '@ipc': resolve(__dirname, './ipc'),
      'http-api': resolve(__dirname, '../../packages/http-api/src/index.ts'),
    },
  },
})
