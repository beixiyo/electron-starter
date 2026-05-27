import type { AliasOptions } from 'vite'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { getRenderConfig } from './vite.config.web'

const alias: AliasOptions = {
  '@shared': resolve(__dirname, './shared'),
  'http-api': resolve(__dirname, '../http-api/src'),
  '@main': resolve(__dirname, './main'),
  '@ipc': resolve(__dirname, './ipc'),
  '@ipc/*': resolve(__dirname, './ipc/*'),
}

/**
 * @link https://cn.electron-vite.org/config
 * @link https://cn.electron-vite.org/guide/build
 */
export default defineConfig((params) => {
  const renderConfig = getRenderConfig(params)

  return {
    renderer: renderConfig,

    main: {
      envDir: './env',
      resolve: {
        alias,
      },
      build: {
        target: 'node20',
        outDir: resolve(__dirname, './out/main'),
        lib: {
          entry: resolve(__dirname, './main/index.ts'),
          formats: ['cjs'],
          fileName: () => 'index.cjs',
        },
      },
      publicDir: resolve(__dirname, './resources'),
    },
    preload: {
      envDir: './env',
      resolve: {
        alias,
      },
      build: {
        target: 'node20',
        outDir: resolve(__dirname, './out/preload'),
        lib: {
          entry: resolve(__dirname, './preload/index.ts'),
          formats: ['cjs'],
          fileName: () => 'index.cjs',
        },
      },
      publicDir: resolve(__dirname, './resources'),
    },
  }
})
