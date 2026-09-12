import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { app, powerSaveBlocker } from 'electron'
import { createMainDiagnosticLogger } from './logging'

const diag = createMainDiagnosticLogger('app.power')

/** 按发起方 webContents 分桶，渲染进程消亡时整桶回收。 */
const activityBuckets = new Map<number, Set<string>>()
/** 已挂消亡监听的 webContents.id，同一 sender 只挂一次。 */
const watchedSenderIds = new Set<number>()
let recordingBlockerId: number | null = null
let activityBlockerId: number | null = null
let initialized = false

/** 注册退出清理，避免录音结束前退出时残留 blocker */
export function initPowerSaveBlockers(): void {
  if (initialized)
    return

  initialized = true
  app.once('will-quit', stopAllPowerSaveBlockers)
}

/** 录音会话存续时保持系统活跃，同时允许显示器自动熄灭 */
export function setRecordingPowerSaveBlocker(active: boolean): void {
  if (active) {
    if (recordingBlockerId != null && powerSaveBlocker.isStarted(recordingBlockerId))
      return

    recordingBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    diag.debug('recording-blocker.started', 'recording power save blocker started', {
      blockerId: recordingBlockerId,
      type: 'prevent-app-suspension',
    })
    return
  }

  stopRecordingPowerSaveBlocker()
}

/** 为一段 renderer 活动启动或复用系统休眠阻止器。 */
export function startActivityPowerSaveBlocker(sender: WebContents): string {
  const requestId = randomUUID()
  let bucket = activityBuckets.get(sender.id)

  if (!bucket) {
    bucket = new Set()
    activityBuckets.set(sender.id, bucket)
  }
  bucket.add(requestId)
  watchActivitySender(sender)

  /** sender 可能在挂监听的同步窗口内销毁，不能留下无人负责的 blocker。 */
  if (!activityBuckets.get(sender.id)?.has(requestId)) {
    diag.debug('activity-blocker.skip-dead-sender', 'skipped activity blocker for gone sender', {
      senderId: sender.id,
      requestId,
    })
    return requestId
  }

  if (activityBlockerId == null || !powerSaveBlocker.isStarted(activityBlockerId)) {
    activityBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    diag.debug('activity-blocker.started', 'activity power save blocker started', {
      blockerId: activityBlockerId,
      requestCount: countActivities(),
      type: 'prevent-app-suspension',
    })
  }

  return requestId
}

/** 结束一段 renderer 活动；未知 requestId 是幂等 no-op。 */
export function stopActivityPowerSaveBlocker(requestId: string): void {
  for (const [senderId, bucket] of activityBuckets) {
    if (!bucket.delete(requestId))
      continue

    if (bucket.size === 0)
      activityBuckets.delete(senderId)
    break
  }

  if (countActivities() === 0)
    stopActivityBlocker()
}

/** renderer 崩溃或窗口销毁时回收该 sender 的全部活动声明。 */
function watchActivitySender(sender: WebContents): void {
  const senderId = sender.id
  if (watchedSenderIds.has(senderId))
    return

  if (sender.isDestroyed()) {
    releaseActivitiesForSender(senderId, 'destroyed')
    return
  }

  watchedSenderIds.add(senderId)
  sender.once('destroyed', () => {
    watchedSenderIds.delete(senderId)
    releaseActivitiesForSender(senderId, 'destroyed')
  })
  sender.on('render-process-gone', () => {
    releaseActivitiesForSender(senderId, 'render-process-gone')
  })
}

function releaseActivitiesForSender(
  senderId: number,
  reason: 'destroyed' | 'render-process-gone',
): void {
  const bucket = activityBuckets.get(senderId)
  activityBuckets.delete(senderId)
  if (!bucket || bucket.size === 0)
    return

  diag.debug('activity-blocker.sender-released', 'released activities for gone sender', {
    senderId,
    reason,
    releasedCount: bucket.size,
    requestCount: countActivities(),
  })

  if (countActivities() === 0)
    stopActivityBlocker()
}

function countActivities(): number {
  let total = 0
  for (const bucket of activityBuckets.values())
    total += bucket.size
  return total
}

function stopRecordingPowerSaveBlocker(): void {
  if (recordingBlockerId == null)
    return

  const blockerId = recordingBlockerId
  recordingBlockerId = null
  const stopped = powerSaveBlocker.stop(blockerId)
  diag.debug('recording-blocker.stopped', 'recording power save blocker stopped', {
    blockerId,
    stopped,
  })
}

function stopActivityBlocker(): void {
  if (activityBlockerId == null)
    return

  const blockerId = activityBlockerId
  activityBlockerId = null
  const stopped = powerSaveBlocker.stop(blockerId)
  diag.debug('activity-blocker.stopped', 'activity power save blocker stopped', {
    blockerId,
    stopped,
  })
}

function stopAllPowerSaveBlockers(): void {
  activityBuckets.clear()
  watchedSenderIds.clear()
  stopRecordingPowerSaveBlocker()
  stopActivityBlocker()
}
