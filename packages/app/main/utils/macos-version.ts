/**
 * macOS 版本门槛判断（只比较版本号，非 darwin 平台的语义由调用方自行决定：
 * 混音支持要求先是 darwin，故调用前应先判平台）
 */
export function isMacOSAtLeast(major: number, minor: number): boolean {
  const [curMajor = 0, curMinor = 0] = process.getSystemVersion().split('.').map(Number)
  return curMajor > major || (curMajor === major && curMinor >= minor)
}
