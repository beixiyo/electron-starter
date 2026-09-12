/** DevTools 在当前构建是否对用户开放 */

/**
 * 判断是否允许打开 DevTools
 *
 * 开发与测试构建默认开放，其余构建需要显式设置环境变量。
 * 所有自动唤起路径共用这里的门槛，避免不同入口产生不一致的行为
 */
export function isDevToolsEnabled(): boolean {
  return import.meta.env.DEV
    || import.meta.env.MODE === 'test'
    || process.env.ELECTRON_APP_ENABLE_DEVTOOLS === '1'
}
