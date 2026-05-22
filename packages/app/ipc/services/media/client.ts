import type { MediaContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const mediaClient = createServiceClient<MediaContract>('media', [
  'getSources',
  'saveBuffer',
  'toggleSystemAudio',
])
