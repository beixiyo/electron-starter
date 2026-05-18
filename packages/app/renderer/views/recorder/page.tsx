import { isElectron } from '../../utils/env'
import ElectronRecorderPage from './ElectronRecorderPage'
import WebRecorderPage from './web'

/**
 * 统一 Recorder 路由入口
 * - 路由只加载这个 page.tsx
 * - 在这里根据环境选择 Electron / Web 版本
 */
export default function RecorderPage(): React.JSX.Element {
  if (isElectron()) {
    return <ElectronRecorderPage />
  }
  return <WebRecorderPage />
}
