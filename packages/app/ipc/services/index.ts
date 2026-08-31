/**
 * 有 main 侧 handler 的 IPC 服务集中注册入口（副作用 import）
 * 含 `mainHandle` / `mainOn` 的服务必须在此显式注册，不要依赖业务模块的传递 import
 * 只有 `rendererOn` 的模块用 `toRenderer.ts`，不注册 handler，因此不进本 barrel
 * 例外：shortcut-config 是工厂函数（createShortcutConfigService），由 main/index.ts 显式创建
 */
import './audio-lab/service'
import './global-toast/service'
import './logical-window/service'
import './media/service'
import './meeting-detection/service'
import './notification/service'
import './oauth/service'
import './permission/service'
import './recording/service'
import './screenshot/service'
import './selection/service'
import './system-preferences/service'
import './update/service'
import './window/service'
