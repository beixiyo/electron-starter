import type { SelectionContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const selectionClient = createServiceClient<SelectionContract>('selection', [
  'showSelectionWindow',
  'closeSelectionWindow',
])
