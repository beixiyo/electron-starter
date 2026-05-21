export * from './screenshot-events'
export * from './selection-events'
/**
 * 渲染进程相关的类型和事件常量
 *
 * 此文件夹包含：
 * - 主进程 → 渲染进程的单向事件常量（*_RENDERER_CHANNEL）
 * - 渲染进程特定的类型定义
 *
 * 注意：双向 IPC 调用或复杂交互的事件应放在 `shared/ipc-events/` 中
 */
export * from './voice-ime-events'
export * from './voice-ime-type'
