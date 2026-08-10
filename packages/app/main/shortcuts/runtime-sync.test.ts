import { describe, expect, it } from 'vitest'
import { onShortcutRuntimeSyncRequested, requestShortcutRuntimeSync } from './runtime-sync'

describe('快捷键运行时同步', () => {
  it('延后处理重新应用期间上报的捕获后端故障', async () => {
    const calls: string[] = []
    let nestedRequest = true
    const unsubscribe = onShortcutRuntimeSyncRequested(() => {
      calls.push('start')
      if (nestedRequest) {
        nestedRequest = false
        requestShortcutRuntimeSync()
      }
      calls.push('end')
    })

    try {
      requestShortcutRuntimeSync()

      expect(calls).toEqual(['start', 'end'])

      await new Promise<void>(resolve => queueMicrotask(resolve))

      expect(calls).toEqual(['start', 'end', 'start', 'end'])
    }
    finally {
      unsubscribe()
    }
  })
})
