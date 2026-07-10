import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getAppStorageAreaPath } from '@main/storage'

const LOG_PATH = getAppStorageAreaPath('native-diagnostic-log', 'native-recorder.log')
const MAX_LOG_BYTES = 5 * 1024 * 1024

let writeChain = Promise.resolve()

/**
 * 串行持久化 native helper stderr，避免音频回调诊断只存在于开发终端
 */
export function appendNativeDiagnosticLine(helper: string, line: string): void {
  writeChain = writeChain
    .then(async () => {
      await mkdir(dirname(LOG_PATH), { recursive: true })

      const size = await stat(LOG_PATH).then(item => item.size).catch(() => 0)
      if (size >= MAX_LOG_BYTES)
        await writeFile(LOG_PATH, '', 'utf-8')

      await appendFile(LOG_PATH, `${new Date().toISOString()} [${helper}] ${line}\n`, 'utf-8')
    })
    .catch((error) => {
      console.warn('[native-log] append failed:', error)
    })
}
