import type { ElectronAPI } from '@electron-toolkit/preload'
import type { MediaSessionSnapshot } from '@shared'
import type { Ipc } from './index'

declare global {
  interface Window {
    $electron: ElectronAPI
    $ipc: Ipc
  }

  declare const $ipc: Ipc
  declare const $electron: ElectronAPI
}
