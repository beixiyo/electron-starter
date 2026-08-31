import type { AudioLabContract } from './contract'
import { createIpcService } from '@ipc/core'
import { updateAudioLabSettings } from '@main/audio-lab/controller'
import { getAudioLabSettings } from '@main/audio-lab/settings'

export const audioLabService = createIpcService<AudioLabContract>('audio-lab', {
  mainHandle: {
    async getSettings() {
      return getAudioLabSettings()
    },

    async updateSettings(_event, patch) {
      return updateAudioLabSettings(patch)
    },
  },
})
