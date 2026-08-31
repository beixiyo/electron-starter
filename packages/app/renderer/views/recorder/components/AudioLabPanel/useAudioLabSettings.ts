import type { AudioLabSettings, AudioLabSettingsPatch } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'

/** 读取并更新主进程持久化的音频实验设置。 */
export function useAudioLabSettings(): AudioLabSettingsState {
  const [settings, setSettings] = useState<AudioLabSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<'load' | 'save' | null>(null)

  useEffect(() => {
    let active = true

    void $ipc.audioLab.getSettings()
      .then((value) => {
        if (!active) return
        setSettings(value)
        setError(null)
      })
      .catch(() => {
        if (active)
          setError('load')
      })
      .finally(() => {
        if (active)
          setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const update = useLatestCallback(async (patch: AudioLabSettingsPatch) => {
    if (saving)
      return false

    setSaving(true)
    try {
      const value = await $ipc.audioLab.updateSettings(patch)
      setSettings(value)
      setError(null)
      return true
    }
    catch {
      setError('save')
      return false
    }
    finally {
      setSaving(false)
    }
  })

  return { error, loading, saving, settings, update }
}

export type AudioLabSettingsState = {
  settings: AudioLabSettings | null
  loading: boolean
  saving: boolean
  error: 'load' | 'save' | null
  update: (patch: AudioLabSettingsPatch) => Promise<boolean>
}
