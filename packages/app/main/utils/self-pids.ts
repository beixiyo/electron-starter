import { getRecorderPid } from '@main/audio-recorder'
import { app } from 'electron'

/**
 * 应用自身进程族 pid（主 / 渲染 / GPU / utility + 录音子进程）
 *
 * tap 全系统混音排除自录：录音子进程不属于 Chromium 进程树，
 * getAppMetrics 抓不到，需单独补上
 */
export function getSelfProcessPids(): number[] {
  const pids = app.getAppMetrics().map(metric => metric.pid)

  const recorderPid = getRecorderPid()
  if (recorderPid) {
    pids.push(recorderPid)
  }

  return pids
}
