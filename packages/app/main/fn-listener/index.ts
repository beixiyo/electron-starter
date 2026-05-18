/**
 * fn/Globe 键监听模块
 * 统一导出核心进程管理与快捷键集成
 */

export { addFnKeyListener, startFnKeyListener, stopFnKeyListener } from './core'
export { registerFnShortcuts, resetFnShortcutStates, setupFnKeyIpc } from './shortcuts'
