/** 编译期功能入口；关闭时同时停止对应状态读取与副作用。 */

/** 运行环境调试入口，正式构建需显式开启。@default import.meta.env.DEV */
export const ENABLE_RUNTIME_TOOLS = import.meta.env.DEV || import.meta.env.VITE_ENABLE_RUNTIME_TOOLS === 'true'

/** 请求模拟仅供开发构建使用。@default import.meta.env.DEV */
export const ENABLE_REQUEST_MOCKS = import.meta.env.DEV
