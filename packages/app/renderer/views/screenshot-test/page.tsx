/** 截图功能测试页：通过真实 Electron IPC 验证启动速度、Blob 交付与原图质量 */

import { Button } from 'comps'
import {
  Clock3,
  Download,
  FileImage,
  Image as ImageIcon,
  LoaderCircle,
  MonitorUp,
  ScanLine,
  Trash2,
} from 'lucide-react'
import { useScreenshotTest } from './useScreenshotTest'

/** 路由 `/screenshot-test` */
export default function ScreenshotTestPage() {
  const screenshot = useScreenshotTest()
  const metrics = [
    {
      label: '浮层打开耗时',
      value: formatDuration(screenshot.openingDurationMs),
    },
    {
      label: '完成总耗时',
      value: formatDuration(screenshot.result?.totalDurationMs ?? null),
    },
    {
      label: '图片尺寸',
      value: screenshot.dimensions
        ? `${screenshot.dimensions.width} × ${screenshot.dimensions.height}`
        : '--',
    },
    {
      label: '文件体积',
      value: screenshot.result
        ? formatFileSize(screenshot.result.blob.size)
        : '--',
    },
  ]

  return (
    <div className="h-full overflow-y-auto px-5 py-6 md:px-8 md:py-8 lg:px-13 lg:py-10">
      <div className="max-w-240 space-y-8">
        <header className="space-y-1">
          <h1 className="text-[22px] font-medium leading-8 text-text">截图功能测试</h1>
          <p className="text-sm leading-5 text-text3">
            主动发起真实区域截图，检查首次打开速度、原始 PNG 尺寸与 Blob URL 预览
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)] md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ImageIcon size={ 17 } className="text-text2" aria-hidden />
                <h2 className="text-sm font-medium text-text">原图预览</h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                { screenshot.result && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={ <Download size={ 14 } /> }
                      onClick={ screenshot.downloadResult }
                    >
                      下载 PNG
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={ <Trash2 size={ 14 } /> }
                      onClick={ screenshot.clearResult }
                    >
                      清除
                    </Button>
                  </>
                ) }
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={ screenshot.busy
                    ? <LoaderCircle size={ 14 } className="animate-spin" />
                    : <ScanLine size={ 14 } /> }
                  disabled={ !screenshot.available || screenshot.busy }
                  onClick={ screenshot.startCapture }
                >
                  { screenshot.busy
                    ? '截图进行中'
                    : screenshot.result
                      ? '重新截图'
                      : '开始截图' }
                </Button>
              </div>
            </div>

            <div className="mt-5 flex min-h-105 items-center justify-center overflow-hidden rounded-xl bg-background shadow-[inset_0_0_0_1px_rgb(var(--border)/0.55)]">
              { screenshot.result
                ? (
                    <img
                      src={ screenshot.result.previewUrl }
                      alt="本次区域截图原图"
                      className="max-h-[62vh] w-full object-contain"
                      onLoad={ event => screenshot.updateDimensions(
                        event.currentTarget.naturalWidth,
                        event.currentTarget.naturalHeight,
                      ) }
                    />
                  )
                : (
                    <div className="flex max-w-80 flex-col items-center px-6 py-16 text-center">
                      <div className="flex size-12 items-center justify-center rounded-2xl bg-background3 text-text3">
                        <ScanLine size={ 22 } strokeWidth={ 1.7 } aria-hidden />
                      </div>
                      <p className="mt-4 text-sm font-medium text-text2">尚未生成截图</p>
                      <p className="mt-1 text-xs leading-5 text-text3">
                        框选后点击确认，裁剪结果会以 PNG Blob 回传到当前页面
                      </p>
                    </div>
                  ) }
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-2 text-xs text-text3">
                <MonitorUp size={ 13 } aria-hidden />
                运行状态
              </div>
              <div className="mt-3 flex items-start gap-2">
                <span className={ `mt-1.5 size-2 shrink-0 rounded-full ${STATUS_DOT_STYLE[screenshot.status.kind]}` } />
                <p className={ `text-sm leading-5 ${STATUS_TEXT_STYLE[screenshot.status.kind]}` } aria-live="polite">
                  { screenshot.status.message }
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-2 text-xs text-text3">
                <Clock3 size={ 13 } aria-hidden />
                性能与画质
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                { metrics.map(metric => (
                  <div key={ metric.label } className="rounded-xl bg-background px-3 py-3">
                    <dt className="text-[11px] leading-4 text-text3">{ metric.label }</dt>
                    <dd className="mt-1 truncate text-sm font-medium text-text">{ metric.value }</dd>
                  </div>
                )) }
              </dl>
              <p className="mt-3 text-[11px] leading-4 text-text3">
                完成总耗时包含人工框选时间；判断冷启动性能请看浮层打开耗时。
              </p>
            </div>

            <div className="rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-2 text-xs text-text3">
                <FileImage size={ 13 } aria-hidden />
                数据链路
              </div>
              <p className="mt-3 text-sm font-medium text-text">ArrayBuffer → Blob → Object URL</p>
              <p className="mt-1 text-xs leading-5 text-text3">
                全程不转 base64；预览缩放只影响页面显示，不会重编码 PNG 文件。
              </p>
              <div className="mt-3 rounded-xl bg-background px-3 py-2.5 font-mono text-[11px] text-text2">
                { screenshot.result?.blob.type || 'image/png' }
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}

function formatDuration(value: number | null): string {
  return value === null
    ? '--'
    : `${Math.round(value)} ms`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const STATUS_DOT_STYLE: Record<ReturnType<typeof useScreenshotTest>['status']['kind'], string> = {
  idle: 'bg-text4',
  opening: 'bg-info',
  selecting: 'bg-info',
  success: 'bg-success',
  cancelled: 'bg-text3',
  error: 'bg-danger',
  unavailable: 'bg-warning',
}

const STATUS_TEXT_STYLE: Record<ReturnType<typeof useScreenshotTest>['status']['kind'], string> = {
  idle: 'text-text2',
  opening: 'text-info',
  selecting: 'text-info',
  success: 'text-success',
  cancelled: 'text-text2',
  error: 'text-danger',
  unavailable: 'text-warning',
}
