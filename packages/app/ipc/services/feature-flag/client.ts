/** 远端开关的渲染进程调用入口。 */
import type { FeatureFlagContract } from './contract'
import { createServiceClient } from '@ipc/core'

export const featureFlagClient = createServiceClient<FeatureFlagContract>('feature-flag', ['sync', 'getState'])
