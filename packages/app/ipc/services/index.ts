/**
 * 所有 IPC 服务的集中注册入口（副作用 import）
 * 服务必须在此显式注册，不要依赖业务模块的传递 import——
 * 业务代码一旦重构掉相关 import，渲染端会静默收不到事件
 * 例外：shortcut-config 是工厂函数（createShortcutConfigService），由 main/index.ts 显式创建
 */
import './fn/service'
import './focus/service'
import './hold/service'
import './logical-window/service'
import './media/service'
import './meeting-detection/service'
import './notification/service'
import './oauth/service'
import './permission/service'
import './screenshot/service'
import './selection/service'
import './shortcut-test/service'
import './update/service'
import './voice-ime/service'
import './window/service'
