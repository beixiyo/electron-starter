/**
 * 性能监控工具
 * 用于测量和记录应用启动和运行时的性能指标
 */

interface PerformanceMark {
  name: string
  timestamp: number
  duration?: number
}

class PerformanceMonitor {
  private marks: Map<string, PerformanceMark> = new Map()
  private startTime: number

  constructor() {
    this.startTime = Date.now()
  }

  /**
   * 记录性能标记点
   */
  mark(name: string): void {
    const timestamp = Date.now()
    this.marks.set(name, {
      name,
      timestamp,
    })
  }

  /**
   * 测量两个标记点之间的时间
   */
  measure(name: string, startMark: string, endMark?: string): number | null {
    const start = this.marks.get(startMark)
    if (!start) {
      console.warn(`[Performance] 标记点 "${startMark}" 不存在`)
      return null
    }

    const end = endMark
      ? this.marks.get(endMark)
      : { timestamp: Date.now() }
    if (!end) {
      console.warn(`[Performance] 标记点 "${endMark}" 不存在`)
      return null
    }

    const duration = end.timestamp - start.timestamp
    console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`)
    return duration
  }

  /**
   * 测量从应用启动到当前的时间
   */
  measureFromStart(name: string): number {
    const duration = Date.now() - this.startTime
    console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms (从启动开始)`)
    return duration
  }

  /**
   * 获取所有性能标记
   */
  getMarks(): PerformanceMark[] {
    return Array.from(this.marks.values())
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    const marks = Array.from(this.marks.values())
      .sort((a, b) => a.timestamp - b.timestamp)

    let report = '\n========== 性能报告 ==========\n'
    report += `启动时间: ${new Date(this.startTime).toISOString()}\n`
    report += `总耗时: ${(Date.now() - this.startTime).toFixed(2)}ms\n\n`

    report += '性能标记点:\n'
    let lastTimestamp = this.startTime
    for (const mark of marks) {
      const duration = mark.timestamp - lastTimestamp
      report += `  ${mark.name}: +${duration.toFixed(2)}ms (累计: ${(mark.timestamp - this.startTime).toFixed(2)}ms)\n`
      lastTimestamp = mark.timestamp
    }

    report += '================================\n'
    return report
  }

  /**
   * 打印性能报告
   */
  printReport(): void {
    console.log(this.generateReport())
  }
}

/** 单例实例 */
let performanceMonitor: PerformanceMonitor | null = null

/**
 * 获取性能监控实例
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  if (!performanceMonitor) {
    performanceMonitor = new PerformanceMonitor()
  }
  return performanceMonitor
}

/**
 * 性能标记装饰器（用于函数）
 */
export function performanceMark(name: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value

    descriptor.value = function (...args: any[]) {
      const monitor = getPerformanceMonitor()
      monitor.mark(`${target.constructor.name}.${propertyKey}.start`)
      const startTime = Date.now()

      const result = originalMethod.apply(this, args)

      if (result instanceof Promise) {
        return result.then((value) => {
          const duration = Date.now() - startTime
          monitor.mark(`${target.constructor.name}.${propertyKey}.end`)
          console.log(
            `[Performance] ${name || `${target.constructor.name}.${propertyKey}`}: ${duration.toFixed(2)}ms`,
          )
          return value
        })
      }
      else {
        const duration = Date.now() - startTime
        monitor.mark(`${target.constructor.name}.${propertyKey}.end`)
        console.log(
          `[Performance] ${name || `${target.constructor.name}.${propertyKey}`}: ${duration.toFixed(2)}ms`,
        )
        return result
      }
    }

    return descriptor
  }
}
