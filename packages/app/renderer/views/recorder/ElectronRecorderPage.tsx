import type { PreviewSummary } from './components/PreviewPanel/types'
import type { PrimaryAction } from './types'
import { Input, LiveWaveAudio, Message, Modal } from 'comps'
import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'
import { PreviewPanel } from './components/PreviewPanel'
import { RecorderSidebar } from './components/RecorderSidebar'
import { SourceGrid } from './components/SourceGrid'
import { buildRecorderStateMeta } from './constants/state-meta'
import { useLiveWaveAudio } from './hooks/useLiveWaveAudio'
import { useRecorderController } from './hooks/useRecorderController'
import { useRecordingTimer } from './hooks/useRecordingTimer'
import { useSourceManager } from './hooks/useSourceManager'
import { RecorderDetail } from './web/RecorderDetail'
import { RecorderList } from './web/RecorderList'

/**
 * Electron 环境下的桌面录制控制台
 */
export default function ElectronRecorderPage(): React.JSX.Element {
  const { t } = useTranslation('app')
  const [viewingRecordId, setViewingRecordId] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [showSourceSelectModal, setShowSourceSelectModal] = useState(false)
  const {
    sources,
    selectedSource,
    selectedSourceId,
    setSelectedSourceId,
    loadingSources,
    loadSources,
    sessionSystemAudio,
  } = useSourceManager()

  const {
    recorderState,
    systemAudio,
    micAudio,
    audioOnly,
    errorMessage,
    loading,
    recordedBlob,
    isRecording,
    isPaused,
    isBusy,
    hasResult,
    showAudioPreview,
    showVideoPreview,
    isLiveAudioPreview,
    isLiveVideoPreview,
    recordedVideoSrc,
    recordedAudioSrc,
    canControlSystemAudio,
    liveVideoRef,
    liveAudioRef,
    start,
    pause,
    resume,
    stop,
    cancel,
    reset,
    download,
    toggleSystemAudio,
    setMicAudio,
    setAudioOnly,
    setSystemAudioFromSession,
    reportError,
    getMediaStream,
    /** 保存到 IndexedDB 相关 */
    showSaveModal,
    saveName,
    saving,
    setSaveName,
    saveToIndexedDB,
    cancelSave,
  } = useRecorderController({
    selectedSource,
  })

  const layoutStyle = useMemo(() => ({
    minHeight: 'calc(100vh - 48px)',
  }), [])

  const refreshSources = useCallback(() => {
    return loadSources().catch(reportError)
  }, [loadSources, reportError])

  /**
   * 处理开始录制
   * 如果是音频录制，直接开始；否则先显示窗口选择 Modal
   */
  const handleStartRecording = useCallback(() => {
    if (audioOnly) {
      /** 音频录制不需要选择窗口，直接开始 */
      start()
      return
    }
    /** 视频录制需要先选择窗口 */
    setShowSourceSelectModal(true)
  }, [audioOnly, start])

  /**
   * 确认选择窗口并开始录制
   */
  const handleConfirmSourceAndStart = useCallback(() => {
    if (!audioOnly && !selectedSource) {
      Message.danger(t('sourceSelection.pleaseSelectSource', '请先选择需要录制的屏幕或窗口'))
      return
    }
    setShowSourceSelectModal(false)
    start()
  }, [audioOnly, selectedSource, start, t])

  const handleSaveToIndexedDB = useCallback(async () => {
    await saveToIndexedDB()
    /** 保存成功后刷新历史记录列表 */
    setListRefreshKey(prev => prev + 1)
  }, [saveToIndexedDB])

  useEffect(() => {
    refreshSources()
  }, [refreshSources])

  /** 当选择窗口 Modal 打开时，自动刷新窗口列表 */
  useEffect(() => {
    if (showSourceSelectModal) {
      refreshSources()
    }
  }, [showSourceSelectModal, refreshSources])

  useEffect(() => {
    if (typeof sessionSystemAudio === 'boolean') {
      setSystemAudioFromSession(sessionSystemAudio)
    }
  }, [sessionSystemAudio, setSystemAudioFromSession])

  useEffect(() => {
    const videoEl = liveVideoRef.current
    if (!videoEl)
      return

    if (isLiveVideoPreview) {
      const stream = getMediaStream()
      if (stream && videoEl.srcObject !== stream) {
        videoEl.srcObject = stream
        videoEl.play().catch(() => {
          /** 忽略自动播放失败 */
        })
      }
      return
    }

    if (videoEl.srcObject) {
      videoEl.srcObject = null
      videoEl.load()
    }
  }, [getMediaStream, isLiveVideoPreview, liveVideoRef])

  useEffect(() => {
    const audioEl = liveAudioRef.current
    if (!audioEl)
      return

    if (isLiveAudioPreview) {
      const stream = getMediaStream()
      if (stream && audioEl.srcObject !== stream) {
        audioEl.srcObject = stream
        audioEl.play().catch(() => {
          /** 忽略自动播放失败 */
        })
      }
      return () => {
        if (audioEl.srcObject) {
          audioEl.pause()
          audioEl.srcObject = null
          audioEl.load()
        }
      }
    }

    if (audioEl.srcObject) {
      audioEl.pause()
      audioEl.srcObject = null
      audioEl.load()
    }
    return undefined
  }, [getMediaStream, isLiveAudioPreview, liveAudioRef])

  const stateMetaMap = useMemo(() => buildRecorderStateMeta(t), [t])
  const stateMeta = stateMetaMap[recorderState]

  const primaryAction = useMemo<PrimaryAction>(() => {
    if (isRecording) {
      return {
        label: t('primaryActions.pause'),
        onClick: pause,
        variant: 'warning',
        disabled: false,
        icon: <Pause className="size-4" />,
        loading: false,
      }
    }
    if (isPaused) {
      return {
        label: t('primaryActions.resume'),
        onClick: resume,
        variant: 'info',
        disabled: false,
        icon: <Play className="size-4" />,
        loading: false,
      }
    }
    return {
      label: t('primaryActions.start'),
      onClick: handleStartRecording,
      variant: 'primary',
      disabled: isBusy || loading,
      icon: <Play className="size-4" />,
      loading,
    }
  }, [isBusy, isPaused, isRecording, loading, pause, resume, handleStartRecording, t])

  const sidebarActions = {
    stopLabel: t('primaryActions.stop'),
    cancelLabel: t('primaryActions.cancel'),
    resetLabel: t('primaryActions.clear'),
    downloadLabel: t('primaryActions.download'),
    isBusy,
    hasResult,
    onStop: stop,
    onCancel: cancel,
    onReset: reset,
    onDownload: download,
  }

  const audioCards = {
    title: t('audioSettings.title'),
    items: [
      {
        title: t('audioSettings.systemAudio.label'),
        description: t('audioSettings.systemAudio.description'),
        checked: systemAudio && canControlSystemAudio,
        disabled: !canControlSystemAudio,
        onChange: (_checked: boolean) => {
          if (!canControlSystemAudio)
            return
          return toggleSystemAudio()
        },
      },
      {
        title: t('audioSettings.microphone.label'),
        description: t('audioSettings.microphone.description'),
        checked: micAudio,
        onChange: setMicAudio,
      },
      {
        title: t('audioSettings.audioOnly.label'),
        description: t('audioSettings.audioOnly.description'),
        checked: audioOnly,
        onChange: setAudioOnly,
      },
    ],
  }

  const summary: PreviewSummary = {
    // visible: hasResult,
    visible: false, // 暂不显示
    typeLabel: t('preview.type'),
    typeValue: recordedBlob?.type ?? '--',
    sizeLabel: t('preview.size'),
    sizeValue: recordedBlob
      ? `${(recordedBlob.size / 1024 / 1024).toFixed(2)} MB`
      : '--',
  }

  /**
   * 音频模式下不显示实时音频预览（空间让给 LiveWaveAudio）
   * 只在有录制结果时显示音频预览
   */
  const audioPreview = showAudioPreview
    ? {
      /** 音频模式下不显示实时预览，只在录制完成后显示 */
        isLive: audioOnly
          ? false
          : isLiveAudioPreview,
        hasResult,
        emptyText: t('preview.noAudioFile'),
        liveTitle: t('preview.liveAudioPreview.title'),
        liveDescription: t('preview.liveAudioPreview.description'),
        liveBadgeText: t('preview.liveAudioPreview.live'),
        recordedSrc: recordedAudioSrc,
        ref: liveAudioRef,
      }
    : undefined

  /** 仅在非音频模式下显示视频预览 */
  const videoPreview = showVideoPreview && !audioOnly
    ? {
        isLive: isLiveVideoPreview,
        hasResult,
        emptyText: t('preview.noRecording'),
        liveBadgeText: t('preview.realtimePreview'),
        recordedSrc: recordedVideoSrc,
        ref: liveVideoRef,
      }
    : undefined

  /** 录制时长管理 */
  const recordingDuration = useRecordingTimer(isRecording, isPaused)

  // LiveWaveAudio 错误处理
  const handleLiveWaveError = useCallback((error: Error) => {
    console.error('LiveWaveAudio error', error)
    Message.danger(
      t('preview.audioVisualizer.error', '实时波形捕获麦克风失败，请检查权限或关闭其他录制软件'),
    )
  }, [t])

  /** 仅在音频模式下显示音频波形（系统音频或麦克风任一开启即可） */
  const shouldShowLiveWave = audioOnly && (micAudio || systemAudio)

  /** 判断是否显示预览面板 */
  const shouldShowPreview = !audioOnly || !shouldShowLiveWave || hasResult

  // LiveWaveAudio 相关逻辑
  const {
    controlsRef: liveWaveControlsRef,
    state: liveWaveState,
    externalStream: liveWaveStream,
  } = useLiveWaveAudio({
    shouldShow: shouldShowLiveWave,
    isRecording,
    isPaused,
    getMediaStream,
    onError: handleLiveWaveError,
  })

  const CARD_HEIGHT = 260

  return (
    <div className="min-h-screen bg-backgroundSubtle px-4 py-6 text-sm text-textPrimary lg:px-8">
      <div
        className="mx-auto flex w-full max-w-[1440px] flex-col gap-5"
        style={ layoutStyle }
      >
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-textPrimary">{ t('recordingTitle') }</h1>
        </header>

        <div className="grid gap-5 xl:grid-cols-[280px,1fr] flex-1 min-h-0">
          <RecorderSidebar
            stateMeta={ stateMeta }
            primaryAction={ primaryAction }
            actions={ sidebarActions }
            audioCards={ audioCards }
            errorMessage={ errorMessage }
            recordingDuration={ recordingDuration }
            isRecording={ isRecording }
            isPaused={ isPaused }
          />

          <div className="flex h-full flex-col gap-5 min-h-0">
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="flex flex-col gap-4 rounded-3xl border border-border bg-background shadow-card p-4" style={ { height: CARD_HEIGHT } }>
                { shouldShowLiveWave && (
                  <LiveWaveAudio
                    ref={ liveWaveControlsRef }
                    state={ liveWaveState }
                    externalStream={ liveWaveStream }
                    mode="static"
                    height={ shouldShowPreview
                      ? undefined
                      : '100%' }
                    className={ cn({ 'flex-1': shouldShowPreview }) }
                    onError={ handleLiveWaveError }
                  />
                ) }
                { shouldShowPreview && (
                  <PreviewPanel
                    title={ t('preview.title') }
                    summary={ summary }
                    audioPreview={ audioPreview }
                    videoPreview={ videoPreview }
                  />
                ) }
              </section>

            </div>

            <section className="flex-1 rounded-3xl border border-border bg-background p-5 shadow-card overflow-hidden flex flex-col">
              <RecorderList
                key={ listRefreshKey }
                onViewRecord={ setViewingRecordId }
                className="space-y-6 flex-1 min-h-0 overflow-y-auto"
              />
            </section>
          </div>
        </div>
      </div>

      <Modal
        isOpen={ showSaveModal }
        onClose={ cancelSave }
        titleText={ t('saveModal.title', '保存录制文件') }
        width={ 500 }
        clickOutsideClose={ false }
        onOk={ handleSaveToIndexedDB }
        okText={ t('saveModal.save', '保存') }
        cancelText={ t('saveModal.cancel', '取消') }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-zinc-700 dark:text-zinc-300">
              { t('saveModal.nameLabel', '文件名称') }
            </label>
            <Input
              value={ saveName }
              onChange={ value => setSaveName(value) }
              placeholder={ t('saveModal.namePlaceholder', '请输入文件名称') }
              onPressEnter={ handleSaveToIndexedDB }
              autoFocus
              disabled={ saving }
            />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            { t('saveModal.description', '录制文件将保存到本地存储中') }
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={ showSourceSelectModal }
        onClose={ () => setShowSourceSelectModal(false) }
        titleText={ t('sourceSelection.title', '选择录制窗口') }
        width={ 900 }
        clickOutsideClose={ false }
        onOk={ handleConfirmSourceAndStart }
        okText={ t('sourceSelection.confirm', '确认并开始录制') }
        cancelText={ t('sourceSelection.cancel', '取消') }
      >
        <SourceGrid
          title={ t('sourceSelection.title') }
          sources={ sources }
          selectedSourceId={ selectedSourceId }
          canSelect={ !isBusy }
          onSelect={ sourceId => setSelectedSourceId(sourceId) }
          emptyState={ {
            loading: t('sourceSelection.loadingSources'),
            empty: t('sourceSelection.noSources'),
          } }
          refresh={ {
            label: t('sourceSelection.refresh'),
            loading: loadingSources,
            onClick: refreshSources,
          } }
          helperText={ {
            cannotSwitch: t('sourceSelection.cannotSwitch'),
            noPreview: t('sourceSelection.noPreview'),
            noDisplayId: t('sourceSelection.noDisplayId'),
            supportsSystemAudio: t('sourceSelection.supportsSystemAudio'),
            microphoneAudioOnly: t('sourceSelection.microphoneAudioOnly'),
          } }
        />
      </Modal>

      <RecorderDetail
        recordId={ viewingRecordId }
        isOpen={ viewingRecordId !== null }
        onClose={ () => setViewingRecordId(null) }
      />
    </div>
  )
}
