import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { createPackageExternal } from '../../scripts/vite/packageExternal'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  /**
   * 保留 ESM 产物中的 import.meta.env.MODE，让最终消费方的 Vite 构建决定运行模式
   * CJS 产物仍优先读取 Node 的 process.env.NODE_ENV
   */
  define: {
    'import.meta.env.MODE': 'import.meta.env.MODE',
  },
  plugins: [
    dts({ tsconfigPath: './tsconfig.json' })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    outDir: './dist',
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        tool: fileURLToPath(new URL('./src/tool.ts', import.meta.url)),
        keyboard: fileURLToPath(new URL('./src/keyboard/index.ts', import.meta.url)),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: createPackageExternal(pkg),
    },
  },
})
