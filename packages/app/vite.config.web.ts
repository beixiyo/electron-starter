import type { UserConfigFnObject } from 'vite'
import { resolve } from 'node:path'
import { autoParseStyles } from '@jl-org/js-to-style'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

/**
 * 本地开发服务端代理基础地址
 * 账号 904371842@qq.com
 * 密码 随意
 */
const devUrl = '192.168.5.195:8080'

export const getRenderConfig: UserConfigFnObject = ({ mode }) => {
  return {
    envDir: '../env',
    root: resolve(__dirname, './renderer'),

    server: {
      port: 6580,
      host: '::',
      proxy: {
        /**
         * 与 packages/old_version 保持一致的代理配置
         * - /api 转发到 {devUrl}/api 并移除前缀
         * - /ws  开启 ws 并移除前缀
         *
         * 注意：需要排除静态资源请求，避免与路径别名冲突
         * 当请求路径包含文件扩展名（如 .ts, .tsx, .js, .jsx, .css 等）时，跳过代理
         */
        '/api': {
          target: `http://${devUrl}`,
          changeOrigin: true,
        },
        '/ws': {
          target: `ws://${devUrl}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },

    build: {
      target: 'esnext',
      sourcemap: mode === 'development',
      outDir: resolve(__dirname, './out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, './renderer/index.html'),
          splash: resolve(__dirname, './renderer/windows/splash/index.html'),
          voiceIme: resolve(__dirname, './renderer/windows/voice-ime/index.html'),
          screenshot: resolve(__dirname, './renderer/windows/screenshot/index.html'),
          menubar: resolve(__dirname, './renderer/windows/menubar/index.html'),
          floatingStatusPool: resolve(__dirname, './renderer/windows/floating-status-pool/index.html'),
          utilityPanelPool: resolve(__dirname, './renderer/windows/utility-panel-pool/index.html'),
        },
      },
    },

    optimizeDeps: {
      include: [
        '@tanstack/react-query',
        'react-i18next',
        'i18next',
        'react',
        'react-dom',
      ],
    },
    esbuild: {
      drop: process.env.NODE_ENV === 'production'
        ? ['console', 'debugger']
        : [],
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './renderer'),
        '@shared': resolve(__dirname, './shared'),
        '@ipc': resolve(__dirname, './ipc'),
        'comps/index.css': resolve(__dirname, '../comps/dist/index.css'),
        'comps': resolve(__dirname, '../comps/src/index.ts'),
        'http-api': resolve(__dirname, '../http-api/src/index.ts'),
        'hooks': resolve(__dirname, '../hooks/src/index.ts'),
      },
    },
    plugins: [
      tailwindcss(),
      svgr(),
      codeInspectorPlugin({
        bundler: 'vite',
        /**
         * 编辑器通过项目根目录 `.env.local` 的 `CODE_EDITOR` 配置
         * @example CODE_EDITOR=code        # VSCode
         * @example CODE_EDITOR=cursor      # Cursor
         * @example CODE_EDITOR=~/bin/open-nvim  # Neovim
         * @link https://inspector.fe-dev.cn/en/more/question.html#using-in-wsl-or-dev-containers
         */
      }),

      // envParse({ dtsPath: './src/vite-env.d.ts' }),
      react(),
      AutoImport({
        imports: ['react'],
        dts: './auto-imports.d.ts',
      }),

      autoParseStyles({
        jsPath: resolve(__dirname, '../styles/variable.ts'),
        cssPath: resolve(__dirname, '../styles/css/autoVariables.css'),
        scssPath: resolve(__dirname, '../styles/scss/autoVariables.scss'),
      }),

      /**
       * @link https://www.npmjs.com/package/react-devtools
       * ```bash
       * npm install -g react-devtools
       * react-devtools
       * ```
       */
      {
        name: 'react-devtools-inject',
        apply: 'serve',
        transformIndexHtml(html) {
          return html.replace(
            '</head>',
            '<script src="http://localhost:8097"></script></head>',
          )
        },
      },
    ],
    worker: {
      format: 'es',
    },
  }
}

export default defineConfig(getRenderConfig)
