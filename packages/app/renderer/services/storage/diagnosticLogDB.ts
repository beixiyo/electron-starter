/** 浏览器结构化日志存储；按时间索引读取与清理，不依赖主进程。 */
import type { StorageAreaId } from '@shared/storage'
import { assertStorageAreaOwner } from '@shared/storage'

const DATABASE_NAME = 'AppDiagnostics'
const DATABASE_VERSION = 1
const STORE_NAME = 'logs'
const TIMESTAMP_INDEX = 'timestamp'
const STORAGE_AREA_ID = 'web-diagnostic-logs-indexeddb' satisfies StorageAreaId

let databasePromise: Promise<IDBDatabase> | null = null

/** Web 诊断日志 IndexedDB；按时间建索引，供诊断工具按范围收集 */
export const diagnosticLogDB = {
  async add(record: StoredDiagnosticLogRecord): Promise<void> {
    const database = await getDatabase()
    await runTransaction(database, 'readwrite', store => requestToPromise(store.add(record)))
  },

  /** 按时间顺序读取记录；默认不限制条数，收集附件时应指定预算。 */
  async getByTimestampRange(startAt: number, endAt: number, options: DiagnosticLogReadOptions = {}): Promise<StoredDiagnosticLogRecord[]> {
    const database = await getDatabase()
    return runTransaction(database, 'readonly', async (store) => {
      const index = store.index(TIMESTAMP_INDEX)
      return cursorToArray(index.openCursor(IDBKeyRange.bound(startAt, endAt), options.direction ?? 'next'), options.limit ?? Infinity)
    })
  },

  async pruneBefore(timestamp: number): Promise<void> {
    const database = await getDatabase()
    await runTransaction(database, 'readwrite', async (store) => {
      const index = store.index(TIMESTAMP_INDEX)
      await deleteCursorRange(index.openCursor(IDBKeyRange.upperBound(timestamp, true)))
    })
  },
}

function getDatabase(): Promise<IDBDatabase> {
  if (databasePromise)
    return databasePromise

  assertStorageAreaOwner(STORAGE_AREA_ID, 'renderer')
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' })

      if (!store.indexNames.contains(TIMESTAMP_INDEX))
        store.createIndex(TIMESTAMP_INDEX, 'timestamp')
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to open diagnostic log database'))
  })

  databasePromise = databasePromise.catch((error) => {
    databasePromise = null
    throw error
  })
  return databasePromise
}

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const operation = run(transaction.objectStore(STORE_NAME))
    let result: T

    operation.then(value => result = value).catch((error) => {
      try {
        transaction.abort()
      }
      catch {
        /** 请求失败时事务可能已被 IndexedDB 自动终止。 */
      }
      reject(error)
    })
    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error ?? new Error('Diagnostic log transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Diagnostic log transaction aborted'))
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Diagnostic log request failed'))
  })
}

function cursorToArray(request: IDBRequest<IDBCursorWithValue | null>, limit: number): Promise<StoredDiagnosticLogRecord[]> {
  return new Promise((resolve, reject) => {
    const records: StoredDiagnosticLogRecord[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || records.length >= limit) {
        resolve(records)
        return
      }

      records.push(cursor.value as StoredDiagnosticLogRecord)
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('Diagnostic log cursor failed'))
  })
}

function deleteCursorRange(request: IDBRequest<IDBCursorWithValue | null>): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }

      cursor.delete()
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('Diagnostic log cleanup cursor failed'))
  })
}

/** IndexedDB 内部记录，额外保存数值时间戳用于范围索引 */
export type StoredDiagnosticLogRecord = {
  id: string
  timestamp: number
  sessionId: string
  time: string
  level: string
  message: string
  module: string
  event: string
  process: 'renderer'
  window: string
  route: string
  platform: 'web'
  appVersion: string
  detail?: unknown
  [key: string]: unknown
}

/** 日志范围读取选项。 */
export interface DiagnosticLogReadOptions {
  /** 最大读取条数；@default Infinity */
  limit?: number
  /** 游标方向；@default 'next' */
  direction?: IDBCursorDirection
}
