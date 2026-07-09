import type { WindowBounds } from '@shared'
import { SHORTCUT_TEST_WINDOW_SIZE } from '@shared'
import { screen } from 'electron'

const SHORTCUT_TEST_SCREEN_MARGIN = 20
const SHORTCUT_TEST_VERTICAL_CENTER_RATIO = 0.62

export function getShortcutTestWindowBounds(): WindowBounds {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const width = Math.min(
    SHORTCUT_TEST_WINDOW_SIZE.width,
    Math.max(area.width - SHORTCUT_TEST_SCREEN_MARGIN * 2, 1),
  )
  const height = Math.min(
    SHORTCUT_TEST_WINDOW_SIZE.height,
    Math.max(area.height - SHORTCUT_TEST_SCREEN_MARGIN * 2, 1),
  )
  const centerX = area.x + area.width / 2
  const centerY = area.y + area.height * SHORTCUT_TEST_VERTICAL_CENTER_RATIO

  return {
    x: clamp(
      Math.round(centerX - width / 2),
      area.x + SHORTCUT_TEST_SCREEN_MARGIN,
      area.x + area.width - width - SHORTCUT_TEST_SCREEN_MARGIN,
    ),
    y: clamp(
      Math.round(centerY - height / 2),
      area.y + SHORTCUT_TEST_SCREEN_MARGIN,
      area.y + area.height - height - SHORTCUT_TEST_SCREEN_MARGIN,
    ),
    width,
    height,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min)
    return min

  return Math.min(Math.max(value, min), max)
}
