import { mountTransparentWindow } from '../shared'
import { FloatingStatusPoolApp } from './FloatingStatusPoolApp'
/**
 * 用到 comps 组件的窗口入口必须引 @/tailwind.css（含 comps/index.css 产物工具类），
 * 不能只引裸 styles css：comps 经 optimizeDeps 预构建后 Tailwind 扫不到其源码，
 * 仅 comps 内部使用的工具类（如 CountdownBorder 的 stroke-brand）是否生成
 * 取决于 .vite 缓存状态，曾致 meeting-toast 倒计时边框描边无色不可见
 */
import '@/tailwind.css'

mountTransparentWindow(<FloatingStatusPoolApp />)
