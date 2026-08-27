// oxlint-disable react-hooks/exhaustive-deps
import type { CaptureKind, RecorderState } from '@jl-org/tool'
import { formatDate, ScreenRecorder } from '@jl-org/tool'
import type { RecordingControls } from 'comps'
import { Input, LiveWaveAudio, Message, Modal } from 'comps'
import { useConst, useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RecorderPageLayout } from '../shared/components/RecorderPageLayout'
import { recorderStorage } from '../utils/storage'
import { RecorderDetail } from './RecorderDetail'
import { RecorderList } from './RecorderList'
import { RecorderOptions } from './RecorderOptions'
import { RecorderPreview } from './RecorderPreview'

type WaveformState = 'recording' | 'stop' | 'idle'

/**
 * 根据录制状态与保存 / 上传过程计算波形组件 state
 *
 * - 录制中：recording
 * - 停止但尚未完成后续处理：stop（冻结当前画面）
 * - 进行保存 / 上传等异步操作：idle（进入组件内置空闲动画）
 */
function resolveWaveformState(params: {
  recState: RecorderState
  isStarting: boolean
  isSaving: boolean
}): WaveformState {
  const {
    recState,
    isStarting,
    isSaving,
  } = params

  /** 保存 / 上传过程中，使用 idle 展示空闲动画 */
  if (isSaving) {
    return 'idle'
  }

  /** 初始化启动阶段以及录制状态都视为 recording */
  if (isStarting || recState === 'recording') {
    return 'recording'
  }

  /** 其它情况（暂停 / 空闲等）统一视为 stop，保持最后一帧画面 */
  return 'stop'
}

/**
 * Web 版本的视频录制页面
 */
export default function WebRecorderPage() {
  const { t } = useTranslation('recorder')
  const [recState, setRecState] = useState<RecorderState>('idle')
  const [micAudio, setMicAudio] = useState<boolean>(true)
  const [systemAudio, setSystemAudio] = useState<boolean>(true)
  const [captureKind, setCaptureKind] = useState<CaptureKind>('audio')

  const [timeslice, setTimeslice] = useState<number | ''>('') // ms
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [lastBlobType, setLastBlobType] = useState<string | null>(null)
  const [currentBlob, setCurrentBlob] = useState<Blob | null>(null)

  const [isStarting, setIsStarting] = useState<boolean>(false)
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false)
  const [saveName, setSaveName] = useState<string>('')
  const [saving, setSaving] = useState<boolean>(false)

  const [viewingRecordId, setViewingRecordId] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const waveformRef = useRef<RecordingControls | null>(null)
  const discardRecordingRef = useRef(false)
  const isAudioMode = captureKind === 'audio'
  const captureKindRef = useRef(captureKind)
  captureKindRef.current = captureKind

  const createDefaultName = (kind: CaptureKind) =>
    `${
      kind === 'audio'
        ? t('audio')
        : t('video')
    }_${formatDate('yyyy-MM-dd HH-mm-ss', new Date())}`

  const recorder = useConst(
    new ScreenRecorder({
      audioOnly: captureKind === 'audio',
      systemAudio,
      micAudio,
      timesliceMs: typeof timeslice === 'number'
        ? timeslice
        : undefined,
      onStateChange: (s) => setRecState(s),
      onError: (e) => {
        console.error(e)
        setIsStarting(false)
      },
      onStart: () => {
        setIsStarting(false)
        if (captureKindRef.current === 'video') {
          /** 绑定视频预览 */
          const stream = recorder.getMediaStream()
          if (videoRef.current && stream) {
            videoRef.current.srcObject = stream
            videoRef.current.controls = false
            videoRef.current.play().catch(() => {})
          }
        }
      },
      onStop: (finalBlob) => {
        const shouldDiscard = discardRecordingRef.current
        discardRecordingRef.current = false

        if (!finalBlob || shouldDiscard) {
          return
        }

        const url = URL.createObjectURL(finalBlob)
        setBlobUrl(url)
        setLastBlobType(finalBlob.type || null)
        setCurrentBlob(finalBlob)

        /** 生成默认名称 */
        const completedKind = captureKindRef.current
        setSaveName(createDefaultName(completedKind))

        /** 显示保存对话框 */
        setShowSaveModal(true)

        if (completedKind === 'video' && videoRef.current) {
          videoRef.current.srcObject = null
          videoRef.current!.src = url
          videoRef.current!.controls = true
        }
      },
    }),
  )

  useEffect(() => {
    recorder.updateConfig({
      audioOnly: captureKind === 'audio',
      video: captureKind === 'video',
      systemAudio,
      micAudio,
      timesliceMs: typeof timeslice === 'number'
        ? timeslice
        : undefined,
    })
  }, [captureKind, systemAudio, micAudio, timeslice, recorder])

  const getAudioLevel = useLatestCallback(
    () => {
      const getLevel = waveformRef.current?.getAudioLevel
      return typeof getLevel === 'function'
        ? getLevel()
        : 0
    },
  )

  const revokeUrl = () => {
    if (blobUrl) {
      console.warn('revokeUrl', blobUrl)
      URL.revokeObjectURL(blobUrl)
    }
    setBlobUrl(null)
  }

  useEffect(() => {
    return () => {
      /** 卸载时释放资源 */
      try {
        recorder.dispose()
      }
      catch {}
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      if (waveformRef.current) {
        // oxlint-disable-next-line react-hooks/exhaustive-deps
        waveformRef.current.destroy()
      }
      revokeUrl()
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      if (videoRef.current) {
        // oxlint-disable-next-line react-hooks/exhaustive-deps
        videoRef.current.srcObject = null
      }
    }
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isAudioMode && waveformRef.current) {
      waveformRef.current.destroy()
      setRecState('idle')
    }
  }, [isAudioMode])

  const handleAudioRecordingFinish = async (audioUrl: string, audioBlob: Blob, _chunks: Blob[]) => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    revokeUrl()
    const shouldDiscard = discardRecordingRef.current
    discardRecordingRef.current = false

    if (shouldDiscard) {
      setRecState('idle')
      return
    }

    const url = URL.createObjectURL(audioBlob)
    setBlobUrl(url)
    setLastBlobType(audioBlob.type || 'audio/webm')
    setCurrentBlob(audioBlob)
    setSaveName(createDefaultName('audio'))
    setShowSaveModal(true)
    setRecState('idle')
  }

  const handleStart = async () => {
    revokeUrl()
    setLastBlobType(null)
    setCurrentBlob(null)
    if (isAudioMode) {
      if (!micAudio) {
        Message.warning(t('messages.micRequired'))
        return
      }

      const controller = waveformRef.current
      if (!controller) {
        Message.danger(t('messages.audioNotReady'))
        return
      }

      setIsStarting(true)
      try {
        await controller.start()
        setRecState('recording')
      }
      catch (error) {
        console.error('启动音频录制失败:', error)
        Message.danger(t('messages.startAudioFailed'))
        setRecState('idle')
      }
      finally {
        setIsStarting(false)
      }
      return
    }

    /** 旧实例清理 */
    try {
      recorder.dispose()
    }
    catch {}

    setIsStarting(true)
    try {
      await recorder.start()
    }
    catch {
      /** 已在内部处理错误状态 */
      setIsStarting(false)
    }
  }

  const handlePause = async () => {
    if (isAudioMode) {
      const controller = waveformRef.current
      if (!controller) {
        return
      }
      try {
        await controller.pause()
        setRecState('paused')
      }
      catch (error) {
        console.error('暂停音频录制失败:', error)
        Message.danger(t('messages.pauseFailed'))
      }
      return
    }
    recorder.pause()
  }

  const handleResume = async () => {
    if (isAudioMode) {
      const controller = waveformRef.current
      if (!controller) {
        return
      }
      try {
        await controller.resume()
        setRecState('recording')
      }
      catch (error) {
        console.error('恢复音频录制失败:', error)
        Message.danger(t('messages.resumeFailed'))
      }
      return
    }
    recorder.resume()
  }

  const handleStop = async () => {
    if (isAudioMode) {
      const controller = waveformRef.current
      if (!controller) {
        return
      }
      try {
        await controller.stop()
        setRecState('idle')
      }
      catch (error) {
        console.error('停止音频录制失败:', error)
        Message.danger(t('messages.stopFailed'))
      }
      return
    }
    recorder.stop()
  }

  const handleDiscardRecording = async () => {
    if (recState !== 'recording' && recState !== 'paused') {
      return
    }

    discardRecordingRef.current = true
    revokeUrl()
    setShowSaveModal(false)
    setSaveName('')
    setCurrentBlob(null)

    if (isAudioMode) {
      const controller = waveformRef.current
      if (!controller) {
        discardRecordingRef.current = false
        return
      }
      try {
        await controller.stop()
      }
      catch (error) {
        discardRecordingRef.current = false
        console.error('取消音频录制失败:', error)
        Message.danger(t('messages.cancelAudioFailed'))
      }
      finally {
        setRecState('idle')
      }
      return
    }

    try {
      await recorder.stop()
    }
    catch (error) {
      discardRecordingRef.current = false
      console.error('取消录屏失败:', error)
      Message.danger(t('messages.cancelScreenFailed'))
    }
  }

  const handleSave = async () => {
    if (!currentBlob || !saveName.trim()) {
      return
    }

    setSaving(true)
    try {
      await recorderStorage.saveRecord(currentBlob, {
        name: saveName.trim(),
        captureKind,
        systemAudio,
        micAudio,
      })
      setShowSaveModal(false)
      setSaveName('')
      setCurrentBlob(null)
      /** 刷新列表 */
      setListRefreshKey((prev) => prev + 1)
    }
    catch (error) {
      console.error('保存录屏失败:', error)
      Message.danger(t('messages.saveFailed'))
    }
    finally {
      setSaving(false)
    }
  }

  const handleCancelSave = () => {
    setShowSaveModal(false)
    setSaveName('')
    setCurrentBlob(null)
  }

  const sidebar = (
    <RecorderOptions
      recState={ recState }
      systemAudio={ systemAudio }
      micAudio={ micAudio }
      captureKind={ captureKind }
      timeslice={ timeslice }
      isStarting={ isStarting }
      onChangeSystemAudio={ setSystemAudio }
      onChangeMicAudio={ setMicAudio }
      onChangeCaptureKind={ setCaptureKind }
      onChangeTimeslice={ setTimeslice }
      onStart={ handleStart }
      onPause={ handlePause }
      onResume={ handleResume }
      onStop={ handleStop }
      onCancel={ handleDiscardRecording }
    />
  )

  return (
    <>
      <RecorderPageLayout
        title={ t('title') }
        subtitle={ t('pageSubtitle') }
        sidebar={ sidebar }
      >
        <RecorderPreview
          videoRef={ videoRef }
          blobUrl={ blobUrl }
          isAudio={ blobUrl && lastBlobType
            ? lastBlobType.startsWith('audio')
            : isAudioMode }
          isRecording={ recState === 'recording' }
          isPaused={ recState === 'paused' }
          isVideoLive={ !isAudioMode && (isStarting || recState === 'recording' || recState === 'paused') }
          getAudioLevel={ getAudioLevel }
          audioRecorder={ isAudioMode
            ? (
              <LiveWaveAudio
                ref={ waveformRef }
                className="h-full"
                height="100%"
                mode="static"
                state={ resolveWaveformState({
                  recState,
                  isStarting,
                  isSaving: saving,
                }) }
                onError={ (error) => {
                  console.error('音频录制发生错误:', error)
                  Message.danger(t('messages.audioError'))
                } }
                onRecordingFinish={ handleAudioRecordingFinish }
              />
            )
            : null }
        />

        <section className="min-w-0 rounded-3xl bg-background2 p-5 shadow-[0_14px_45px_rgba(15,23,42,0.08)]">
          <RecorderList
            key={ listRefreshKey }
            onViewRecord={ setViewingRecordId }
            className="space-y-6"
          />
        </section>
      </RecorderPageLayout>

      <Modal
        isOpen={ showSaveModal }
        onClose={ handleCancelSave }
        titleText={ t('saveModal.title') }
        width={ 500 }
        clickOutsideClose={ false }
        onOk={ handleSave }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-text2">
              { t('saveModal.nameLabel') }
            </label>
            <Input
              value={ saveName }
              onChange={ (value) => setSaveName(value) }
              placeholder={ t('saveModal.namePlaceholder') }
              onPressEnter={ handleSave }
              autoFocus
              disabled={ saving }
            />
          </div>
          <p className="text-xs text-text3">
            { t('saveModal.description') }
          </p>
        </div>
      </Modal>

      <RecorderDetail
        recordId={ viewingRecordId }
        isOpen={ viewingRecordId !== null }
        onClose={ () => setViewingRecordId(null) }
      />
    </>
  )
}
