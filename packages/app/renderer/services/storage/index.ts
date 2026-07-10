import { createStore } from './createStore'

export * from './createStore'

/**
 * 全项目 localforage 实例集中声明处
 *
 * 新增持久化需求时先在 `shared/storage` 登记，再在这里创建实例
 */

/** 录屏和录音的 Blob、元信息与记录索引 */
export const recorderDB = createStore({
  storageAreaId: 'recorder-indexeddb',
  name: 'RecorderStorage',
  storeName: 'records',
  description: '录屏数据存储',
})
