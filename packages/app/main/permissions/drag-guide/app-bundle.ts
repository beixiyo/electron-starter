/**
 * 解析当前进程对应的 `.app` bundle 路径
 *
 * 拖进 TCC 列表的必须是 bundle 目录本身，不是 `Contents/MacOS/` 里的可执行文件：
 * 裸二进制在 macOS 26 上拖进「辅助功能」列表不会显示条目（26.1–26.3 均有复现），
 * 用户会以为什么都没发生
 */

/**
 * 取路径上**最外层**的 `.app`
 *
 * 取最外层而不是最靠近可执行文件的那个：TCC 把授权记在进程所属的那个 bundle 上，
 * 对主进程而言就是外层应用本身。路径里嵌着 helper bundle 时
 * （`MyApp.app/Contents/Frameworks/Xxx Helper.app/Contents/MacOS/…`），
 * 从内往外找会拖出 helper，用户在列表里看到的就成了一条陌生条目
 *
 * 开发态解析出的是 `Electron.app`——那正是 dev 下真正需要被授权的 bundle，不是缺陷
 * 找不到 `.app` 时返回 null，调用方据此降级为「在 Finder 中显示」，
 * 而不是留一个拖不动的图标
 *
 * @param executablePath 通常传 `app.getPath('exe')`
 */
export function resolveAppBundlePath(executablePath: string): string | null {
  const segments = executablePath.split('/')

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].endsWith('.app')) {
      return segments.slice(0, i + 1).join('/')
    }
  }

  return null
}
