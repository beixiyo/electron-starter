import { installWebIpcShim } from '@/utils/ipcWebShim'
import { mountTransparentWindow } from '../shared'
import { PermissionDragGuideApp } from './PermissionDragGuideApp'
/**
 * 独立窗口自己的 bundle，main.tsx 的 `@/locales` 初始化不会被打包进来，
 * 卡片用到 useTranslation('windows')，须在此显式初始化 i18next
 */
import '@/locales'
/** 卡片大量使用任意值 Tailwind 工具类，须引 @/tailwind.css 取得完整工具类产物 */
import '@/tailwind.css'

installWebIpcShim()
mountTransparentWindow(<PermissionDragGuideApp />)
