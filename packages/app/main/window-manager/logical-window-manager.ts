import type { LogicalWindowRoute, PooledLogicalWindowConfig, PooledLogicalWindowType, PoolWindowType, WindowBounds, WindowConfig, WindowType } from '@shared'
import type { BrowserWindow } from 'electron'
import { logicalWindowService } from '@ipc/services/logical-window/service'
import { LOGICAL_WINDOW_REGISTRY } from '@shared'
import { clearCurrentLogicalWindowRoute, getCurrentLogicalWindowRoute, setCurrentLogicalWindowRoute } from './logical-window-state'
import { windowManager } from './window-manager'

/**
 * 逻辑窗口管理器
 *
 * 对外仍然使用业务窗口类型（如 MEETING_TOAST / SELECTION），内部根据
 * LOGICAL_WINDOW_REGISTRY 决定它是独占 BrowserWindow，还是复用某个池窗口
 *
 * 调用方通常不需要关心物理窗口类型；只有在需要直接操作真实 BrowserWindow
 * 时，才使用 resolvePhysicalType / getPhysicalWindow
 */
class LogicalWindowManager {
  /**
   * 判断某个业务窗口是否已经接入窗口池
   */
  isPooled(type: WindowType): type is PooledLogicalWindowType {
    return LOGICAL_WINDOW_REGISTRY[type]?.strategy === 'pool'
  }

  /**
   * 创建窗口但默认不展示
   *
   * - 独占窗口：直接委托给 windowManager.create(type)
   * - 池化窗口：创建对应池窗口，并把池窗口路由到指定业务窗口
   */
  create(type: WindowType, options: LogicalWindowCreateOptions = {}): BrowserWindow | null {
    if (!this.isPooled(type))
      return windowManager.create(type, options.configOverride)

    return this.acquire(type, {
      ...options,
      show: false,
    })
  }

  /**
   * 创建并展示一个逻辑窗口
   *
   * 池化窗口会先 acquire 对应的池窗口，再向 renderer 发送 route 事件，
   * renderer 根据 route.role 切换到对应业务组件
   *
   * 池化窗口抢占被拒绝（优先级不足或占用者不可中断）时返回 null
   */
  show(type: WindowType, options: LogicalWindowShowOptions = {}): BrowserWindow | null {
    if (!this.isPooled(type)) {
      const win = windowManager.create(type)
      windowManager.show(type, options.autoFocus ?? true)
      return win
    }

    return this.acquire(type, {
      ...options,
      show: true,
    })
  }

  /**
   * 展示窗口但不抢焦点，适合 toast / 浮层一类的弱打扰窗口
   */
  showInactive(type: WindowType, options: Omit<LogicalWindowShowOptions, 'autoFocus'> = {}): BrowserWindow | null {
    return this.show(type, {
      ...options,
      autoFocus: false,
    })
  }

  /**
   * 隐藏逻辑窗口
   *
   * 对池化窗口来说，只有当前池窗口正在承载这个逻辑类型时才会真正隐藏池窗口；
   * 如果池已经被切到别的逻辑窗口，这次 hide 会被视为过期操作并直接成功
   */
  hide(type: WindowType): boolean {
    if (!this.isPooled(type))
      return windowManager.hide(type)

    const entry = LOGICAL_WINDOW_REGISTRY[type]
    const activeRoute = getCurrentLogicalWindowRoute(entry.pool)
    if (activeRoute?.logicalType !== type)
      return true

    this.clearRoute(entry.pool)
    return windowManager.hide(entry.pool)
  }

  /**
   * 销毁逻辑窗口
   *
   * 池窗口是共享资源，池化窗口不允许真的销毁它，只释放占用（等价 hide）；
   * 独占窗口直接销毁真实 BrowserWindow
   */
  destroy(type: WindowType): boolean {
    if (this.isPooled(type))
      return this.hide(type)

    return windowManager.destroy(type)
  }

  /**
   * 按当前可见状态切换显示/隐藏，并返回切换后的可见状态
   *
   * 展示被抢占判定拒绝时返回 false
   */
  toggle(type: WindowType): boolean {
    if (this.isVisible(type)) {
      this.hide(type)
      return false
    }

    return this.show(type) !== null
  }

  /**
   * 判断逻辑窗口当前是否可见
   *
   * 池化窗口必须同时满足：
   * 1. 当前池 route 指向该逻辑类型
   * 2. 真实池窗口处于 visible 状态
   */
  isVisible(type: WindowType): boolean {
    if (!this.isPooled(type))
      return windowManager.isVisible(type)

    const entry = LOGICAL_WINDOW_REGISTRY[type]
    return this.isActive(type) && windowManager.isVisible(entry.pool)
  }

  /**
   * 判断逻辑窗口是否存在
   *
   * 对池化窗口来说，这里的“存在”表示它当前是池窗口的 active route，
   * 不表示池窗口本身是否已经创建
   */
  exists(type: WindowType): boolean {
    if (!this.isPooled(type))
      return windowManager.exists(type)

    return this.isActive(type)
  }

  /**
   * 判断某个池化逻辑窗口是否正在占用它所属的池窗口
   */
  isActive(type: PooledLogicalWindowType): boolean {
    const entry = LOGICAL_WINDOW_REGISTRY[type]
    return getCurrentLogicalWindowRoute(entry.pool)?.logicalType === type
  }

  /**
   * 获取承载该逻辑窗口的真实 BrowserWindow
   *
   * 对池化窗口，只有当池窗口当前 route 仍然指向该逻辑类型时才返回；
   * 这样可以避免调用方误操作已经被复用给其他业务的池窗口
   */
  getTargetWindow(type: WindowType): BrowserWindow | undefined {
    if (!this.isPooled(type))
      return windowManager.get(type)

    const entry = LOGICAL_WINDOW_REGISTRY[type]
    const route = getCurrentLogicalWindowRoute(entry.pool)
    if (route?.logicalType !== type)
      return undefined

    return windowManager.get(entry.pool)
  }

  /**
   * 调整逻辑窗口尺寸
   *
   * 池化窗口会被解析到对应的物理池窗口，所以这里会改变整个池窗口尺寸
   */
  resizeTo(type: WindowType, width: number, height: number, animate = false): boolean {
    return windowManager.resizeTo(this.resolvePhysicalType(type), width, height, animate)
  }

  /**
   * 设置逻辑窗口 bounds
   *
   * 池化窗口会被解析到对应的物理池窗口，所以这里会移动/缩放整个池窗口
   */
  setBounds(type: WindowType, bounds: Partial<WindowBounds>, animate = false): boolean {
    return windowManager.setBounds(this.resolvePhysicalType(type), bounds, animate)
  }

  /**
   * 读取逻辑窗口当前 bounds
   */
  getBounds(type: WindowType): WindowBounds | null {
    return windowManager.getBounds(this.resolvePhysicalType(type))
  }

  /**
   * 获取逻辑窗口对应的物理 BrowserWindow
   *
   * 与 getTargetWindow 不同：池化窗口即使当前不是 active route，
   * 只要它的池窗口已经存在，这里也会返回池窗口
   */
  getPhysicalWindow(type: WindowType): BrowserWindow | undefined {
    return windowManager.get(this.resolvePhysicalType(type))
  }

  /**
   * 把业务窗口类型解析成真实 BrowserWindow 类型
   *
   * - dedicated / lazy：返回自身
   * - pool：返回承载它的池窗口类型
   */
  resolvePhysicalType(type: WindowType): WindowType {
    if (!this.isPooled(type))
      return type

    return LOGICAL_WINDOW_REGISTRY[type].pool
  }

  /**
   * 占用一个池窗口来承载指定逻辑窗口
   *
   * 这里是池化切换的核心：
   * 1. 抢占判定：低优先级请求不能打断可见的高优先级/不可中断窗口
   * 2. 确保池窗口已创建
   * 3. 按需设置 bounds
   * 4. 写入当前 route 状态
   * 5. 把 route 发送给池窗口 renderer
   * 6. 按需展示池窗口
   *
   * 抢占被拒绝时返回 null，调用方可据此判断展示失败
   */
  private acquire(type: PooledLogicalWindowType, options: LogicalWindowAcquireOptions): BrowserWindow | null {
    const entry = LOGICAL_WINDOW_REGISTRY[type]
    if (!this.canAcquire(type, entry.pool))
      return null

    const win = windowManager.create(entry.pool)
    if (!win || win.isDestroyed())
      return null

    win.setIgnoreMouseEvents(false)

    if (options.bounds)
      windowManager.setBounds(entry.pool, options.bounds, options.animateBounds ?? false)

    const route = setCurrentLogicalWindowRoute({
      logicalType: type,
      poolType: entry.pool,
      role: entry.role,
      payload: options.payload,
    })

    this.emitRoute(win, route)

    if (options.show) {
      windowManager.show(entry.pool, options.autoFocus ?? true)
    }

    return win
  }

  /**
   * 抢占判定：新的逻辑窗口能否占用池窗口
   *
   * - 池空闲、或当前占用者就是自己：直接放行
   * - 池窗口实际不可见（route 残留）：直接放行
   * - 当前占用者 interruptible: false：拒绝
   * - 其余按 priority 比较，新请求 >= 当前占用者才放行
   */
  private canAcquire(type: PooledLogicalWindowType, poolType: PoolWindowType): boolean {
    const activeRoute = getCurrentLogicalWindowRoute(poolType)
    if (!activeRoute || activeRoute.logicalType === type)
      return true

    if (!windowManager.isVisible(poolType))
      return true

    /** 用宽化的 pool 配置类型读取，避免 registry 字面量收窄让分支被判定为恒假 */
    const current: PooledLogicalWindowConfig = LOGICAL_WINDOW_REGISTRY[activeRoute.logicalType]
    if (current.interruptible === false)
      return false

    const next: PooledLogicalWindowConfig = LOGICAL_WINDOW_REGISTRY[type]
    return (next.priority ?? 0) >= (current.priority ?? 0)
  }

  /**
   * 向池窗口 renderer 发送 route
   *
   * 如果页面还在加载，延后到 did-finish-load，避免首帧启动时事件丢失
   */
  private emitRoute(win: BrowserWindow, route: LogicalWindowRoute): void {
    const emit = (): void => {
      if (!win.isDestroyed())
        logicalWindowService.emit('route', route, win)
    }

    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', emit)
      return
    }

    emit()
  }

  /**
   * 清空某个池窗口当前 route，并通知 renderer 回到空状态
   */
  private clearRoute(poolType: PoolWindowType): void {
    clearCurrentLogicalWindowRoute(poolType)
    const win = windowManager.get(poolType)
    if (!win || win.isDestroyed())
      return

    win.setIgnoreMouseEvents(false)
    logicalWindowService.emit('clear', { poolType }, win)
  }
}

export const logicalWindowManager = new LogicalWindowManager()

/**
 * 逻辑窗口展示参数
 *
 * bounds / animateBounds 会作用到真实 BrowserWindow；池化窗口场景下，
 * 这意味着改变的是承载它的池窗口
 */
export type LogicalWindowShowOptions = {
  bounds?: Partial<WindowBounds>
  /**
   * 发送给池窗口 renderer 的业务数据
   *
   * 只有池化窗口会通过 LogicalWindowRoute 传递 payload
   */
  payload?: unknown
  /**
   * 展示时是否抢焦点；默认 true
   */
  autoFocus?: boolean
  /**
   * 设置 bounds 时是否使用动画
   */
  animateBounds?: boolean
}

/**
 * create 专用参数：比展示参数多一个独占窗口的配置覆盖
 */
export type LogicalWindowCreateOptions = LogicalWindowShowOptions & {
  /**
   * 独占窗口创建时的 BrowserWindow 配置覆盖；池化窗口忽略，
   * 池窗口配置只来自 PHYSICAL_WINDOW_CONFIGS
   */
  configOverride?: Partial<WindowConfig>
}

/**
 * acquire 内部使用的参数，比展示参数多一个 show 开关，
 * 用来复用“创建但不展示”和“创建并展示”的池化流程
 */
type LogicalWindowAcquireOptions = LogicalWindowShowOptions & {
  show: boolean
}
