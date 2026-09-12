/** 所有渲染入口共用的 CSP，部署所需来源通过构建配置追加。 */
import type { Plugin } from 'vite'

const DEFAULT_SOURCES = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://appleid.cdn-apple.com', 'http://localhost:*'],
  'worker-src': ["'self'", 'blob:'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'font-src': ["'self'", 'data:', 'blob:'],
  /** ObjectURL 图片需要 blob:，否则资源存在但页面仅留下 CSP 拦截。 */
  'img-src': ["'self'", 'data:', 'blob:'],
  'media-src': ["'self'", 'data:', 'blob:'],
  'connect-src': ["'self'", 'data:', 'blob:', 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*'],
}

/**
 * 给每个入口注入唯一 CSP，移除旧 meta，避免多份策略按交集生效。
 * 追加的来源必须包含 scheme；省略端口只匹配默认端口，联调可显式使用 :*。
 */
export function cspPlugin(options: CspOptions = {}): Plugin {
  const content = Object.entries(DEFAULT_SOURCES)
    .map(([directive, defaults]) => {
      const sources = [...defaults, ...(options.additionalSources?.[directive as CspDirective] ?? [])]
      for (const source of sources) {
        if (/[\s;<>]/.test(source))
          throw new Error(`Invalid CSP source for ${directive}: ${source}`)
      }
      return `${directive} ${[...new Set(sources)].join(' ')}`
    })
    .join('; ')

  return {
    name: 'unified-csp-inject',
    transformIndexHtml(html) {
      return {
        html: html.replace(/<meta\b[^>]*>/gi, tag => /http-equiv\s*=\s*(["'])Content-Security-Policy\1/i.test(tag)
          ? ''
          : tag),
        tags: [{
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content },
          injectTo: 'head-prepend',
        }],
      }
    },
  }
}

/** 模板支持追加来源的 CSP 指令。 */
export type CspDirective = keyof typeof DEFAULT_SOURCES

/** 构建期 CSP 配置。 */
export interface CspOptions {
  /** 按指令追加可信来源。@default {} */
  additionalSources?: Partial<Record<CspDirective, string[]>>
}
