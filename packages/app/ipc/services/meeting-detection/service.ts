import type { MeetingDetectionContract } from './contract'
import { readFileSync, unlinkSync } from 'node:fs'
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

  async readRecordingFile(_event, filePath: string) {
    const buf = readFileSync(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  },

  async deleteRecordingFile(_event, filePath: string) {
    try { unlinkSync(filePath) }
    catch { /* ignore */ }
  },
})
