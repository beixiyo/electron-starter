/**
 * 快捷键管理模块
 * 提供全局快捷键和应用内快捷键的管理功能
 */

/** 导入清理模块以注册应用退出时的清理逻辑 */
import './cleanup'

/** 导出双击全局快捷键管理 */
export * from './double-shortcut'

/** 导出长按全局快捷键管理 */
export * from './hold-shortcut'

/** 导出应用内快捷键管理 */
export * from './local'

/** 导出普通全局快捷键管理 */
export * from './normal-shortcut'

/** 导出类型 */
export * from './types'
