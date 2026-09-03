/**
 * 随包资源的路径解析
 */

import { app } from 'electron'
import { join } from 'node:path'

/**
 * 解析一个同时存在于 `resources/` 与 electron-builder `extraResources` 里的文件路径
 *
 * 开发态走 vite 的 `?asset` 导入（指向源码树），打包后走 `process.resourcesPath`
 * （由 electron-builder.yml 的 extraResources 拷入）。两条路径指向同一份文件，
 * 调用方只需把 `?asset` 的导入结果与打包后的文件名一并传入
 *
 * @param fileName extraResources 中 `to` 对应的文件名，例如 `icon.png`
 * @param devAsset `import x from '../resources/<file>?asset'` 的结果
 */
export function resolveBundledResource(fileName: string, devAsset: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, fileName)
    : devAsset
}
