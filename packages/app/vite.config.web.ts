import type { UserConfigFnObject } from 'vite'
import { resolve } from 'node:path'
import { autoParseStyles } from '@jl-org/js-to-style'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig } from 'vite'
import { envParse } from 'vite-plugin-env-parse'
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
          bypass(req) {
            const url = req.url || ''
            /**
             * 排除静态资源请求（包含文件扩展名的请求）
             * 这些请求应该由 Vite 处理，而不是代理到后端
             */
            if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|json|svg|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|map)$/i.test(
              url,
            )) {
              return url
            }
            /** 排除 Vite 的内部请求（如 HMR、source map 等） */
            // Vite 的模块请求通常包含查询参数，如 ?import、&t= 等
            if (url.includes('?') && (url.includes('import') || url.includes('&t=') || url.includes('?t='))) {
              return url
            }
            /**
             * 如果请求路径看起来像文件路径（包含 /api/ 但后面跟着文件路径结构）
             * 这可能是 Vite 在解析模块时生成的路径
             */
            if (/^\/api\/[^/]+\.[^/]+/.test(url)) {
              return url
            }
            return undefined
          },
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
          voiceIme: resolve(__dirname, './renderer/voice-ime.html'),
          shortcutTest: resolve(__dirname, './renderer/shortcut-test.html'),
          selection: resolve(__dirname, './renderer/selection.html'),
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
         * @example CODE_EDITOR=~/bin/nvim-open  # Neovim
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
        apply: 'serve', // 仅在开发服务器模式下应用
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
