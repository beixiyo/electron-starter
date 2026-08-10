import type { PermissionKind } from '@shared'
import type { PreviewSummary } from './components/PreviewPanel/types'
import type { PrimaryAction } from './types'
import { Input, LiveWaveAudio, Message, Modal } from 'comps'
import { useLatestCallback } from 'hooks'
import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'
import { useRecordingSourceState } from '@/store/recordingStore'
import { PermissionModal, usePermissions } from '../../components/permission'
import { AudioSourceBar } from './components/AudioSourceBar'
import { PreviewPanel } from './components/PreviewPanel'
import { RecorderSidebar } from './components/RecorderSidebar'
import { SourceGrid } from './components/SourceGrid'
import { buildRecorderStateMeta } from './constants/state-meta'
import { useLiveWaveAudio } from './hooks/useLiveWaveAudio'
import { useMeetingRecordingSaver } from './hooks/useMeetingRecordingSaver'
import { useNativeManualRecording } from './hooks/useNativeManualRecording'
import { useRecorderController } from './hooks/useRecorderController'
import { useRecordingTimer } from './hooks/useRecordingTimer'
import { useRecoverableRecordings } from './hooks/useRecoverableRecordings'
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

  useMeetingRecordingSaver(() => {
    setListRefreshKey(prev => prev + 1)
    Message.success(t('meetingRecording.saved', '会议录音已保存'))
  })
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

  const permissions = usePermissions()

  /**
   * 原生 Core Audio tap 录音控制器（macOS 14.2+ 可混入所有软件系统音频，无需屏幕录制权限）
   * 引擎选择：Electron + 支持 + 「仅录音」→ 走原生 tap；录视频 / 不支持 → 回退 web ScreenRecorder
   */
  const native = useNativeManualRecording(() => {
    setListRefreshKey(prev => prev + 1)
    Message.success(t('meetingRecording.saved', '录音已保存'))
  })
  useRecoverableRecordings(() => {
    setListRefreshKey(prev => prev + 1)
  })
  const { micEnabled, systemAudioMixEnabled } = useRecordingSourceState()

  const nativeMode = native.supported && audioOnly

  const effIsRecording = nativeMode
    ? native.isRecording
    : isRecording
  const effIsStarting = nativeMode && native.isStarting
  const effIsPaused = nativeMode
    ? native.isPaused
    : isPaused
  const effIsBusy = nativeMode
    ? native.isBusy
    : isBusy

  /** 原生录音开录：只申请用户实际选择的音源权限 */
  const handleStartNative = useLatestCallback(async () => {
    if (micEnabled) {
      const micOk = await permissions.ensure(['microphone'], {
        title: t('permission.recordingTitle', '允许应用录制你的会议'),
        subtitle: t('permission.recordingSubtitle', '为正常录制，请授予以下权限'),
      })
      if (!micOk)
        return
    }

    if (systemAudioMixEnabled) {
      const status = await $ipc.permission.request('system-audio')
      if (status !== 'granted' && status !== 'unknown') {
        Message.warning(t('audioSource.permissionDenied'))
        return
      }
    }
    native.start()
  })

  const layoutStyle = useMemo(() => ({
    minHeight: 'calc(100vh - 48px)',
  }), [])

  const refreshSources = useCallback(() => {
    return loadSources().catch(reportError)
  }, [loadSources, reportError])

  /**
   * 权限满足后真正进入录制流程
   * 音频录制直接开始；视频录制先显示窗口选择 Modal
   */
  const proceedStart = useLatestCallback(() => {
    if (audioOnly) {
      /** 音频录制不需要选择窗口，直接开始 */
      start()
      return
    }
    /** 视频录制需要先选择窗口 */
    setShowSourceSelectModal(true)
  })

  /**
   * 处理开始录制：先做权限前置检查
   * - 麦克风（micAudio）/ 屏幕录制（systemAudio）未授予时弹出权限引导窗
   * - 权限满足后才进入录制流程
   */
  const handleStartRecording = useLatestCallback(async () => {
    const kinds: PermissionKind[] = []
    if (micAudio) {
      kinds.push('microphone')
    }
    if (systemAudio) {
      kinds.push('screen')
    }

    const ok = await permissions.ensure(kinds, {
      title: t('permission.recordingTitle', '允许应用录制你的会议'),
      subtitle: t('permission.recordingSubtitle', '为正常录制，请授予以下权限'),
    })
    if (ok) {
      proceedStart()
    }
  })

  /** 权限引导窗「继续」：关闭后进入录制流程 */
  const handlePermissionContinue = useLatestCallback(() => {
    permissions.close()
    proceedStart()
  })

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

  /**
   * 仅在打开「选择窗口」Modal（即视频录制流程）时才拉取桌面源
   * 不在挂载时预拉：desktopCapturer.getSources 带缩略图枚举屏幕，
   * 本身就会在 macOS 上触发「屏幕录制」权限，纯麦克风录音无需如此
   */
  useEffect(() => {
    if (showSourceSelectModal) {
      refreshSources()
    }
  }, [showSourceSelectModal, refreshSources])

  useEffect(() => {
    /** audioOnly 下不从会话同步系统音频，避免把屏幕录制权限带进纯录音流程 */
    if (!audioOnly && typeof sessionSystemAudio === 'boolean') {
      setSystemAudioFromSession(sessionSystemAudio)
    }
  }, [audioOnly, sessionSystemAudio, setSystemAudioFromSession])

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
  const stateMeta = stateMetaMap[nativeMode
    ? native.phase
    : recorderState]

  const primaryAction = useMemo<PrimaryAction>(() => {
    if (effIsStarting) {
      return {
        label: t('primaryActions.starting'),
        onClick: native.cancel,
        variant: 'primary',
        disabled: true,
        icon: <Play className="size-4" />,
        loading: true,
      }
    }
    if (effIsRecording) {
      return {
        label: t('primaryActions.pause'),
        onClick: nativeMode
          ? native.pause
          : pause,
        variant: 'warning',
        disabled: false,
        icon: <Pause className="size-4" />,
        loading: false,
      }
    }
    if (effIsPaused) {
      return {
        label: t('primaryActions.resume'),
        onClick: nativeMode
          ? native.resume
          : resume,
        variant: 'info',
        disabled: false,
        icon: <Play className="size-4" />,
        loading: false,
      }
    }
    return {
      label: t('primaryActions.start'),
      onClick: nativeMode
        ? handleStartNative
        : handleStartRecording,
      variant: 'primary',
      disabled: effIsBusy || loading,
      icon: <Play className="size-4" />,
      loading,
    }
  }, [effIsBusy, effIsPaused, effIsRecording, effIsStarting, nativeMode, native.cancel, native.pause, native.resume, loading, pause, resume, handleStartNative, handleStartRecording, t])

  const sidebarActions = {
    stopLabel: t('primaryActions.stop'),
    cancelLabel: t('primaryActions.cancel'),
    resetLabel: t('primaryActions.clear'),
    downloadLabel: t('primaryActions.download'),
    isBusy: effIsBusy,
    hasResult: nativeMode
      ? false
      : hasResult,
    onStop: nativeMode
      ? native.stop
      : stop,
    onCancel: nativeMode
      ? native.cancel
      : cancel,
    onReset: reset,
    onDownload: download,
  }

  const audioOnlyCard = {
    title: t('audioSettings.audioOnly.label'),
    description: t('audioSettings.audioOnly.description'),
    checked: audioOnly,
    disabled: effIsBusy,
    onChange: setAudioOnly,
  }

  /**
   * 原生 tap 模式：音源多选（麦克风 + 所有软件）由 AudioSourceBar 承载，
   * 只保留「仅录音」开关；web 模式沿用系统音频 / 麦克风 / 仅录音三个开关
   */
  const audioCards = {
    title: t('audioSettings.title'),
    items: nativeMode
      ? [audioOnlyCard]
      : [
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
          audioOnlyCard,
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

  /** Web 录制由 renderer 计时；native 录制直接使用 main 的就绪后时钟 */
  const rendererRecordingDuration = useRecordingTimer(
    !nativeMode && effIsRecording,
    !nativeMode && effIsPaused,
  )
  const recordingDuration = nativeMode
    ? native.elapsedSeconds
    : rendererRecordingDuration

  // LiveWaveAudio 错误处理
  const handleLiveWaveError = useCallback((error: Error) => {
    console.error('LiveWaveAudio error', error)
    Message.danger(
      t('preview.audioVisualizer.error', '实时波形捕获麦克风失败，请检查权限或关闭其他录制软件'),
    )
  }, [t])

  /** 仅在 web 音频模式下显示音频波形（原生 tap 录音无 MediaStream，不走波形/预览） */
  const shouldShowLiveWave = !nativeMode && audioOnly && (micAudio || systemAudio)

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
        className="mx-auto flex w-full max-w-360 flex-col gap-5"
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
            audioSourceBar={ nativeMode
              ? <AudioSourceBar />
              : null }
            errorMessage={ errorMessage }
            recordingDuration={ recordingDuration }
            isRecording={ effIsRecording }
            isPaused={ effIsPaused }
          />

          <div className="flex h-full flex-col gap-5 min-h-0">
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="flex flex-col gap-4 rounded-3xl border border-border bg-background shadow-card p-4" style={ { height: CARD_HEIGHT } }>
                { nativeMode
                  ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                        <p className="text-sm font-medium text-textPrimary">
                          { effIsStarting
                            ? t('nativeRecording.starting', '正在准备麦克风与系统音频…')
                            : effIsBusy
                              ? t('nativeRecording.recording', '正在录制（可混入系统音频）…')
                              : t('nativeRecording.idle', '选择音源后点击开始录制') }
                        </p>
                        <p className="text-xs text-textSecondary">
                          { t('nativeRecording.hint', '录制完成后自动保存到下方列表') }
                        </p>
                      </div>
                    )
                  : (
                      <>
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
                      </>
                    ) }
              </section>

            </div>

            <section className="min-h-[480px] rounded-3xl border border-border bg-background p-5 shadow-card overflow-hidden flex flex-col">
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

      <PermissionModal
        isOpen={ permissions.open }
        onClose={ permissions.close }
        kinds={ permissions.kinds }
        statuses={ permissions.statuses }
        title={ permissions.title }
        subtitle={ permissions.subtitle }
        canContinue={ permissions.canContinue }
        onRequest={ permissions.requestOne }
        onContinue={ handlePermissionContinue }
      />

      <RecorderDetail
        recordId={ viewingRecordId }
        isOpen={ viewingRecordId !== null }
        onClose={ () => setViewingRecordId(null) }
      />
    </div>
  )
}
