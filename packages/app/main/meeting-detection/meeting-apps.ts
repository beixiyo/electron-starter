export type MeetingAppDefinition = {
  id: string
  displayName: string
  bundleIds: string[]
}

/** 已知会议应用，匹配后显示友好名称 */
export const KNOWN_APPS: MeetingAppDefinition[] = [
  {
    id: 'zoom',
    displayName: 'Zoom',
    bundleIds: ['us.zoom.xos'],
  },
  {
    id: 'teams',
    displayName: 'Microsoft Teams',
    bundleIds: ['com.microsoft.teams', 'com.microsoft.teams2'],
  },
  {
    id: 'slack',
    displayName: 'Slack',
    bundleIds: ['com.tinyspeck.slackmacgap'],
  },
  {
    id: 'line',
    displayName: 'LINE',
    bundleIds: ['jp.naver.line.mac'],
  },
  {
    id: 'lark',
    displayName: '飞书会议',
    bundleIds: ['com.electron.lark'],
  },
]

/**
 * 匹配已知会议应用，返回友好名称
 * 未匹配时返回 null，调用方应使用进程名作为 fallback
 */
export function matchApp(bundleId: string): MeetingAppDefinition | null {
  for (const app of KNOWN_APPS) {
    if (app.bundleIds.some(id => bundleId.startsWith(id))) {
      return app
    }
  }
  return null
}
