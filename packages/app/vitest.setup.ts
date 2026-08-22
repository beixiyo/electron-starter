/**
 * 主进程测试跑在 node 环境，Electron 注入到 process 上的扩展 API 一概不存在
 *
 * 这些不是 Node 标准 API，import 不到、也 mock 不了模块，只能在进入用例前补到
 * process 上。缺了会让依赖它们的 beforeAll 直接抛错，整个 describe 被静默 skip
 */

/** Electron 独有：返回 macOS 版本号，isMacOSAtLeast 用它判断 tap 引擎可用性 */
if (typeof (process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion !== 'function') {
  Object.defineProperty(process, 'getSystemVersion', {
    configurable: true,
    writable: true,
    value: () => '14.2.0',
  })
}
