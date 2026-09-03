/**
 * 权限拖拽引导卡片的位置计算
 *
 * 纯函数，不碰 Electron API：主进程拿到「系统设置」窗口的实测矩形后调用，
 * 便于对贴合与越界收敛做单测
 */

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

/** 卡片可见内容底边与系统设置窗口底边之间的留白 */
const BOTTOM_MARGIN = 44

/** 收敛进工作区时，卡片可见内容与屏幕边缘至少保留的距离 */
const SCREEN_MARGIN = 8

/**
 * 把卡片贴到系统设置窗口的下半部分：水平居中于该窗口，底部对齐其底边上方一段留白
 *
 * 贴在窗口**内部**而不是外部下方，是因为引导语「拖到上面的列表里」要成立，
 * 箭头必须指向同一个窗口里的列表；浮在窗口外的卡片读起来就成了一个无关的对话框。
 *
 * @param settingsBounds 系统设置窗口矩形（全局屏幕坐标）
 * @param workArea 卡片所在显示器的可用工作区
 * @param contentSize 卡片可见内容尺寸（不含透明阴影留白）
 * @param shadowInset 窗口四周为阴影预留的透明留白
 * @returns BrowserWindow 应设置的矩形（已含阴影留白）
 */
export function computeDragGuideBounds(
  settingsBounds: Rect,
  workArea: Rect,
  contentSize: { width: number, height: number },
  shadowInset: number,
): Rect {
  const contentX = settingsBounds.x + (settingsBounds.width - contentSize.width) / 2
  const contentY = settingsBounds.y + settingsBounds.height - contentSize.height - BOTTOM_MARGIN

  const clamped = clampContentToWorkArea(
    { x: contentX, y: contentY, ...contentSize },
    workArea,
  )

  return {
    x: Math.round(clamped.x - shadowInset),
    y: Math.round(clamped.y - shadowInset),
    width: contentSize.width + shadowInset * 2,
    height: contentSize.height + shadowInset * 2,
  }
}

/**
 * 只保证**可见内容**落在工作区内，透明阴影区域允许越界
 *
 * 卡片比工作区还大时以左上角对齐兜底：宁可右下被裁，也不要让文案起始处跑到屏幕外
 */
function clampContentToWorkArea(content: Rect, workArea: Rect): Rect {
  const minX = workArea.x + SCREEN_MARGIN
  const minY = workArea.y + SCREEN_MARGIN
  const maxX = workArea.x + workArea.width - content.width - SCREEN_MARGIN
  const maxY = workArea.y + workArea.height - content.height - SCREEN_MARGIN

  return {
    ...content,
    x: maxX < minX
      ? minX
      : Math.min(Math.max(content.x, minX), maxX),
    y: maxY < minY
      ? minY
      : Math.min(Math.max(content.y, minY), maxY),
  }
}

/** 两次采样是否指向同一个窗口位置；用于等待系统设置窗口停止动画 */
export function isSameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
