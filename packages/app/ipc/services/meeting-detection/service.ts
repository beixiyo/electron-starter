import type { MeetingDetectionContract } from './contract'
import { readFile, unlink } from 'node:fs/promises'
import { createIpcService } from '@ipc/core'
import { pauseRecording, resumeRecording, startRecording, stopRecording } from '@main/audio-recorder'
import { dismissSession, suppressSession } from '@main/meeting-detection/meeting-detector'

export const meetingDetectionService = createIpcService<MeetingDetectionContract>('meeting-detection', {
  async dismiss(_event, appId: string, pid: number) {
    dismissSession(appId, pid)
  },

  async startRecording(_event, appId: string, pid: number) {
    suppressSession(appId, pid)
    startRecording()
    console.log(`[meeting-detection] recording started for: ${appId} pid=${pid}`)
  },

  async pauseRecording() {
    pauseRecording()
  },

  async resumeRecording() {
    resumeRecording()
  },

  async stopRecording() {
    stopRecording()
  },

  /** 录音可达几十 MB，必须异步读取，避免阻塞主进程事件循环 */
  async readRecordingFile(_event, filePath: string) {
    const buf = await readFile(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  },

  async deleteRecordingFile(_event, filePath: string) {
    try { await unlink(filePath) }
    catch { /* ignore */ }
  },
})
