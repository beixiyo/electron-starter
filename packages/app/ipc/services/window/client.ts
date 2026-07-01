import type { WindowContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const windowClient = createServiceClient<WindowContract>('window', [
  'create',
  'openOAuth',
  'show',
  'hide',
  'toggle',
  'destroy',
  'isVisible',
  'exists',
  'getMetadata',
  'getAllTypes',
  'release',
  'isHolding',
  'getState',
  'resizeTo',
  'setBounds',
  'getBounds',
  'setIgnoreMouseEvents',
])
