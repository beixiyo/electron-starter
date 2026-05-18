import type { DesktopSourceFetchResult, DesktopSourceInfo } from '../utils/fetchDesktopSources'
import { useCallback, useMemo, useState } from 'react'
import { fetchDesktopSources } from '../utils/fetchDesktopSources'

export function useSourceManager() {
  const [sources, setSources] = useState<DesktopSourceInfo[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string>()
  const [loadingSources, setLoadingSources] = useState(false)
  const [sessionSystemAudio, setSessionSystemAudio] = useState<boolean | null>(null)

  const selectedSource = useMemo(
    () => sources.find(item => item.id === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  )

  const loadSources = useCallback(async (): Promise<DesktopSourceFetchResult> => {
    setLoadingSources(true)
    try {
      const result = await fetchDesktopSources({
        types: ['screen', 'window'],
        thumbnailWidth: 360,
        thumbnailHeight: 210,
        fetchWindowIcons: true,
      })
      setSources(result.sources)
      setSelectedSourceId((prev) => {
        if (prev && result.sources.some(source => source.id === prev)) {
          return prev
        }
        return result.sources[0]?.id
      })
      if (typeof result.session?.systemAudio === 'boolean') {
        setSessionSystemAudio(result.session.systemAudio)
      }
      return result
    }
    finally {
      setLoadingSources(false)
    }
  }, [])

  return {
    sources,
    selectedSource,
    selectedSourceId,
    setSelectedSourceId,
    loadingSources,
    loadSources,
    sessionSystemAudio,
  }
}
