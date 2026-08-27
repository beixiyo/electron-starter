/** 全局消息窗口测试页：通过真实 IPC 创建、替换与关闭浮窗 */

import type { GlobalToastPlacement, ShowGlobalToastOptions } from '@shared'
import { Button, Input, NumberInput, Select } from 'comps'
import { CircleOff, Clock3, LocateFixed, MessageSquareText, Send, X } from 'lucide-react'
import { useGlobalToastDemo } from './useGlobalToastDemo'

const PLACEMENT_OPTIONS = [
  { value: 'voice-ime', label: '语音输入窗上方（不可见时回落底部）' },
  { value: 'top', label: '顶部居中' },
  { value: 'top-left', label: '左上角' },
  { value: 'top-right', label: '右上角' },
  { value: 'bottom', label: '底部居中' },
  { value: 'bottom-left', label: '左下角' },
  { value: 'bottom-right', label: '右下角' },
] satisfies { value: GlobalToastPlacement; label: string }[]

const PRESETS = [
  {
    label: '默认提示',
    description: '底部居中 · 3 秒',
    options: { text: '操作已完成', placement: 'bottom', duration: 3000, offset: 96 },
  },
  {
    label: '语音输入提示',
    description: '贴近 Voice IME · 4 秒',
    options: { text: '上一条语音输入仍在处理中…', placement: 'voice-ime', duration: 4000, offset: 8 },
  },
  {
    label: '角落提示',
    description: '右上角 · 5 秒',
    options: { text: '已保存到本地', placement: 'top-right', duration: 5000, offset: 48 },
  },
  {
    label: '常驻消息',
    description: '左下角 · 手动关闭',
    options: { text: '这条消息会一直保留', placement: 'bottom-left', duration: 0, offset: 48 },
  },
] as const satisfies readonly GlobalToastPreset[]

/** 路由 `/global-toast-test` */
export default function GlobalToastTestPage() {
  const demo = useGlobalToastDemo()

  return (
    <div className="h-full overflow-y-auto px-5 py-6 md:px-8 md:py-8 lg:px-13 lg:py-10">
      <div className="max-w-200 space-y-8">
        <header className="space-y-1">
          <h1 className="text-[22px] font-medium leading-8 text-text">消息窗口测试</h1>
          <p className="text-sm leading-5 text-text3">
            通过真实 IPC 懒创建透明置顶窗口，验证尺寸、落点、替换与自动关闭
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-5 rounded-2xl bg-background2 p-6 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-2">
              <MessageSquareText size={ 17 } className="text-text2" aria-hidden />
              <h2 className="text-sm font-medium text-text">创建参数</h2>
            </div>

            <div>
              <label className="mb-2 block text-sm text-text2">消息文案</label>
              <Input
                value={ demo.text }
                onChange={ demo.setText }
                placeholder="输入要展示的消息"
                onPressEnter={ () => demo.show() }
              />
            </div>

            <div>
              <label className="mb-2 flex items-center gap-1.5 text-sm text-text2">
                <LocateFixed size={ 14 } aria-hidden />
                窗口落点
              </label>
              <Select
                options={ PLACEMENT_OPTIONS }
                value={ demo.placement }
                onChange={ (value) => demo.setPlacement(value as GlobalToastPlacement) }
                dropdownMaxHeight={ 260 }
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberInput
                label="持续时间"
                value={ demo.duration }
                min={ 0 }
                step={ 500 }
                suffix="ms"
                onChange={ demo.updateDuration }
              />
              <NumberInput
                label="落点间距"
                value={ demo.offset }
                min={ 0 }
                max={ 240 }
                step={ 4 }
                suffix="px"
                onChange={ demo.updateOffset }
              />
            </div>

            <p className="flex items-center gap-1.5 text-xs text-text3">
              <Clock3 size={ 13 } aria-hidden />
              持续时间设为 0 时常驻，直到创建新消息或手动关闭
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                variant="primary"
                leftIcon={ <Send size={ 16 } /> }
                disabled={ !demo.available }
                onClick={ () => demo.show() }
              >
                创建消息窗口
              </Button>
              <Button
                variant="ghost"
                leftIcon={ <X size={ 16 } /> }
                disabled={ !demo.available }
                onClick={ demo.dismiss }
              >
                关闭当前消息
              </Button>
            </div>
          </div>

          <aside className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
              <div className="text-xs text-text3">运行环境</div>
              <div className="mt-2 flex items-center gap-2 text-sm font-medium text-text">
                <span
                  className={ `size-2 rounded-full ${
                    demo.available
                      ? 'bg-success'
                      : 'bg-warning'
                  }` }
                />
                { demo.available
                  ? 'Electron IPC 已连接'
                  : 'Web 预览模式' }
              </div>
            </div>

            <div className="rounded-2xl bg-background2 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-2 text-xs text-text3">
                <CircleOff size={ 13 } aria-hidden />
                最近操作
              </div>
              <p className={ `mt-2 text-sm leading-5 ${STATUS_STYLE[demo.status.kind]}` }>
                { demo.status.message }
              </p>
            </div>
          </aside>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-text">快速场景</h2>
            <p className="mt-1 text-xs text-text3">预设会直接覆盖上方参数并发送创建请求</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            { PRESETS.map((preset) => (
              <button
                key={ preset.label }
                type="button"
                disabled={ !demo.available }
                className="group rounded-2xl bg-background2 px-5 py-4 text-left shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-[transform,box-shadow,opacity] hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(0,0,0,0.08)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
                onClick={ () => demo.show(preset.options) }
              >
                <span className="block text-sm font-medium text-text">{ preset.label }</span>
                <span className="mt-1 block text-xs text-text3">{ preset.description }</span>
              </button>
            )) }
          </div>
        </section>
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<ReturnType<typeof useGlobalToastDemo>['status']['kind'], string> = {
  idle: 'text-text2',
  sent: 'text-success',
  dismissed: 'text-text2',
  error: 'text-danger',
  unavailable: 'text-warning',
}

type GlobalToastPreset = {
  label: string
  description: string
  options: ShowGlobalToastOptions
}
