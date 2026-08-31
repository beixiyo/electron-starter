import type { AudioLabContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const audioLabClient = createServiceClient<AudioLabContract>('audio-lab', [
  'getSettings',
  'updateSettings',
])
