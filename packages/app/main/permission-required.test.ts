/** 首次系统授权成功应放行采集；已经拒绝时只展示现有授权说明。 */
import { beforeEach, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  status: 'not-determined',
  request: vi.fn(),
  emit: vi.fn(),
  show: vi.fn(),
  window: { isDestroyed: () => false },
}))
vi.mock('./permissions', () => ({ getPermissionStatus: () => harness.status, requestPermission: harness.request }))
vi.mock('./main-window-opener', () => ({ ensureMainWindowReady: async () => harness.window }))
vi.mock('./window-manager', () => ({ windowManager: { show: harness.show } }))
vi.mock('@ipc/services/permission/service', () => ({ permissionService: { emit: harness.emit } }))
import { ensureMicrophonePermissionOrExplain } from './permission-required'

beforeEach(() => {
  vi.clearAllMocks()
  harness.status = 'not-determined'
})

it('等待首次系统授权完成后放行，已经拒绝时不重复请求', async () => {
  let authorize!: (status: string) => void
  harness.request.mockReturnValue(new Promise(resolve => { authorize = resolve }))
  const pending = ensureMicrophonePermissionOrExplain('voice-ime')
  expect(harness.request).toHaveBeenCalledWith('microphone')
  expect(harness.emit).not.toHaveBeenCalled()
  authorize('granted')
  expect(await pending).toBe(true)
  expect(harness.emit).not.toHaveBeenCalled()

  harness.status = 'denied'
  expect(await ensureMicrophonePermissionOrExplain('voice-ime')).toBe(false)
  expect(harness.request).toHaveBeenCalledOnce()
  expect(harness.emit).toHaveBeenCalledWith('required', { kinds: ['microphone'], reason: 'voice-ime' }, harness.window)
})
