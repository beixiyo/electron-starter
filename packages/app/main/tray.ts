import { WindowType } from '@shared'
import { SHADOW_INSET } from '@shared/window-config/constants'
import { app, Menu, nativeImage, screen, Tray } from 'electron'
import icon from '../resources/icon.png?asset'
import { windowManager } from './window-manager'

let tray: Tray | null = null
let menubarBlurAttached = false

export type TrayOptions = {
  /**
   * 点击 Open / Setting 时打开主窗口
   * 由调用方注入「不存在则重建」的逻辑——windowManager.show 对已销毁的窗口只会静默返回 false
   */
  onOpenMain?: () => void
}

export function initTray(options: TrayOptions = {}): void {
  if (tray)
    return

  const openMain = options.onOpenMain
    ?? (() => windowManager.show(WindowType.MAIN))

  const image = nativeImage.createFromPath(icon)
  image.setTemplateImage(true)

  tray = new Tray(image.resize({ width: 22, height: 22 }))
  tray.setToolTip('Electron Starter')

  tray.on('click', (_event, bounds) => {
    const win = ensureMenubarWindow()
    if (!win)
      return

    if (win.isVisible()) {
      win.hide()
      return
    }

    const winBounds = win.getBounds()
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    const workArea = display.workArea

    let x = Math.round(bounds.x + bounds.width / 2 - winBounds.width / 2)
    const y = bounds.y + bounds.height + 4 - SHADOW_INSET

    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - winBounds.width))

    win.setPosition(x, y)
    win.show()
  })

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open',
        click: openMain,
      },
      { type: 'separator' },
      {
        label: 'Setting',
        click: openMain,
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => app.quit(),
      },
    ])
    tray?.popUpContextMenu(contextMenu)
  })

  ensureMenubarWindow(false)
}

function ensureMenubarWindow(create = true): Electron.BrowserWindow | null {
  const existing = windowManager.get(WindowType.MENUBAR)
  const win = existing && !existing.isDestroyed()
    ? existing
    : create
      ? windowManager.create(WindowType.MENUBAR)
      : null

  if (!win)
    return null

  if (!menubarBlurAttached) {
    menubarBlurAttached = true
    win.on('blur', () => {
      win.hide()
    })
    win.on('closed', () => {
      menubarBlurAttached = false
    })
  }

  return win
}
