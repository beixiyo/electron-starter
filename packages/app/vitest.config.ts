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

  test: {
    setupFiles: [resolve(__dirname, './vitest.setup.ts')],

    /**
     * 打包会把整份源码（含测试文件）拷进 dist 供 electron-builder 使用，
     * 不排除的话构建过一次之后每个用例都会被跑两遍
     */
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
    ],

    server: {
      deps: {
        /**
         * @electron-toolkit/utils 内部 `import { BrowserWindow } from 'electron'`，
         * 不内联的话它绕过测试里的 vi.mock('electron') 直接去解析 electron 的 CJS 导出而报错
         */
        inline: ['@electron-toolkit/utils'],
      },
    },
  },
})
