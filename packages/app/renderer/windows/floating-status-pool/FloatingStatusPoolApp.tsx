import type { MeetingToastInitialEvent } from '../meeting-toast/useMeetingToast'
import { WindowType } from '@shared'
import { memo } from 'react'
import { MeetingToastApp } from '../meeting-toast/MeetingToastApp'
import { useLogicalWindowRoute } from '../shared'

export const FloatingStatusPoolApp = memo(() => {
  const route = useLogicalWindowRoute(WindowType.FLOATING_STATUS_POOL)

  if (!route)
    return null

  if (route.role === 'meeting-toast') {
    return (
      <MeetingToastApp
        key={ route.token }
        initialEvent={ toMeetingToastInitialEvent(route.payload) }
      />
    )
  }

  return null
})

FloatingStatusPoolApp.displayName = 'FloatingStatusPoolApp'

function toMeetingToastInitialEvent(payload: unknown): MeetingToastInitialEvent | null {
  if (!payload || typeof payload !== 'object')
    return null

  const event = payload as Partial<MeetingToastInitialEvent>
  return event.type === 'detected' || event.type === 'recording-state'
    ? event as MeetingToastInitialEvent
    : null
}
