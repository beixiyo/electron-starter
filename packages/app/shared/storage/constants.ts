import type { StorageAreaEntry } from './types'

export const APP_STORAGE_DIR_NAME = '.electron-app'

export const STORAGE_ROOTS = {
  appHome: `~/${APP_STORAGE_DIR_NAME}`,
  electronUserData: 'app.getPath("userData")',
  updaterCache: 'LOCALAPPDATA | ~/Library/Caches | XDG_CACHE_HOME',
} as const

export const STORAGE_AREAS = [
  {
    id: 'main-json-store',
    owner: 'main',
    root: STORAGE_ROOTS.appHome,
    basePath: '',
    path: '<filename>.json',
    content: '主进程 JSON 偏好，例如快捷键配置',
    entrypoints: [
      'main/storage/json-file.ts',
      'main/storage/paths.ts',
      'main/store/index.ts',
      'main/store/shortcut-bindings.ts',
    ],
    accountScoped: false,
    logoutCleanup: false,
    sensitive: false,
    rebuildable: false,
    ttl: 'none',
  },
  {
    id: 'window-bounds',
    owner: 'main',
    root: STORAGE_ROOTS.electronUserData,
    basePath: 'window-bounds.json',
    path: 'window-bounds.json',
    content: '需要跨重启恢复的窗口尺寸和位置',
    entrypoints: [
      'main/storage/json-file.ts',
      'main/storage/paths.ts',
      'main/window-manager/bounds-store.ts',
    ],
    accountScoped: false,
    logoutCleanup: false,
    sensitive: false,
    rebuildable: true,
    ttl: 'none',
  },
  {
    id: 'recording-recovery-files',
    owner: 'main',
    root: STORAGE_ROOTS.appHome,
    basePath: 'recordings/pending',
    path: 'recordings/pending/<taskId>.<m4a|json|mic.caf|m4a.segments>',
    content: 'native 录音产物、元信息、checkpoint 与麦克风 sidecar',
    entrypoints: [
      'main/recording-recovery/index.ts',
      'main/native-recording/manual.ts',
      'ipc/services/meeting-detection/service.ts',
      'ipc/services/recording/service.ts',
    ],
    accountScoped: false,
    logoutCleanup: false,
    sensitive: true,
    rebuildable: false,
    ttl: '成功导入 IndexedDB 或用户删除后清理',
  },
  {
    id: 'diagnostic-logs',
    owner: 'main',
    root: STORAGE_ROOTS.appHome,
    basePath: 'logs',
    path: 'logs/<sessionId>/app.jsonl',
    content: 'main、renderer 与 native helper 的 session 级结构化诊断日志',
    entrypoints: [
      'main/logging/index.ts',
      'renderer/logging/index.ts',
    ],
    accountScoped: false,
    logoutCleanup: false,
    sensitive: true,
    rebuildable: false,
    ttl: '单文件 10 MB 或 1 天轮转，每个 session 最多 30 个文件',
  },
  {
    id: 'recorder-indexeddb',
    owner: 'renderer',
    root: STORAGE_ROOTS.electronUserData,
    basePath: 'IndexedDB / RecorderStorage / records',
    path: 'IndexedDB / RecorderStorage / records',
    content: '录屏和录音的 Blob、元信息与记录索引',
    entrypoints: [
      'renderer/services/storage/index.ts',
      'renderer/views/recorder/utils/storage.ts',
    ],
    accountScoped: false,
    logoutCleanup: false,
    sensitive: true,
    rebuildable: false,
    ttl: '用户主动删除记录前保留',
  },
  {
    id: 'renderer-local-storage',
    owner: 'renderer',
    root: STORAGE_ROOTS.electronUserData,
    basePath: 'Local Storage',
    path: 'Local Storage',
    content: '鉴权缓存、语言、录音音源和 Web 快捷键偏好',
    entrypoints: [
      'renderer/store/createUserActions.ts',
      'renderer/store/recordingStore.ts',
      'renderer/locales/index.ts',
      'renderer/shortcuts/shortcutConfigAdapter.ts',
    ],
    accountScoped: false,
    logoutCleanup: true,
    sensitive: true,
    rebuildable: true,
    ttl: '由业务自行定义',
  },
  {
    id: 'updater-cache',
    owner: 'main',
    root: STORAGE_ROOTS.updaterCache,
    basePath: 'app-updater/pending',
    path: 'app-updater/pending',
    content: 'electron-updater 待安装包缓存',
    entrypoints: [
      'ipc/services/update/service.ts',
    ],
    accountScoped: false,
    logoutCleanup: false,
    sensitive: false,
    rebuildable: true,
    ttl: '由 electron-updater 管理',
  },
] as const satisfies readonly StorageAreaEntry[]

/**
 * 稳定的存储区 id，用于实现、诊断和后续迁移
 */
export type StorageAreaId = typeof STORAGE_AREAS[number]['id']
