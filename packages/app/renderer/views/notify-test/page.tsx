import { Button } from 'comps'
import { BadgeCheck, Bell, ListChecks, MessageSquareReply, Pin, Repeat2, ShieldCheck, Trash2, X } from 'lucide-react'
import type { NotifyLog } from './useNotifyDemo'
import { useNotifyDemo } from './useNotifyDemo'

/**
 * 通知测试页（路由 `/notify-test`）
 *
 * Web 与 Electron 通用：点按钮发通知，下方实时打印各回调事件，
 * 用于手动验证 `@/utils/notify` 的跨平台行为
 */
export default function NotifyTestPage() {
  const {
    logs,
    env,
    sendBasic,
    sendActions,
    sendReply,
    sendSticky,
    sendReplace,
    closeLast,
    askPermission,
    checkSupport,
    clearLogs,
  } = useNotifyDemo()

  return (
    <div className="h-full overflow-y-auto px-8 py-8 lg:px-13 lg:py-10">
      <div className="max-w-180 space-y-8">
        { /* 标题 */ }
        <header className="space-y-1">
          <h1 className="text-[22px] font-medium leading-8 text-text">
            通知测试
          </h1>
          <p className="text-sm text-text3">
            点击按钮发送通知，下方实时记录各回调事件
          </p>
        </header>

        { /* 环境信息 */ }
        <section className="grid grid-cols-2 gap-2 rounded-2xl bg-background2 p-2 shadow-[0_8px_30px_rgba(0,0,0,0.06)] sm:grid-cols-4">
          <EnvCell label="运行环境" value={ env.runtime } />
          <EnvCell label="平台" value={ env.platform } />
          <EnvCell label="通知权限" value={ env.permission } />
          <EnvCell
            label="是否支持"
            value={ env.supported === null
              ? '未检测'
              : env.supported
              ? '支持'
              : '不支持' }
          />
        </section>

        { /* 发送动作 */ }
        <section className="space-y-3">
          <SectionTitle>发送</SectionTitle>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" leftIcon={ <Bell size={ 16 } /> } onClick={ sendBasic }>
              基础通知
            </Button>
            <Button variant="secondary" leftIcon={ <ListChecks size={ 16 } /> } onClick={ sendActions }>
              带按钮
            </Button>
            <Button variant="secondary" leftIcon={ <MessageSquareReply size={ 16 } /> } onClick={ sendReply }>
              带回复
            </Button>
            <Button variant="secondary" leftIcon={ <Pin size={ 16 } /> } onClick={ sendSticky }>
              常驻
            </Button>
            <Button variant="secondary" leftIcon={ <Repeat2 size={ 16 } /> } onClick={ sendReplace }>
              tag 替换
            </Button>
            <Button variant="ghost" leftIcon={ <X size={ 16 } /> } onClick={ closeLast }>
              关闭最近
            </Button>
          </div>
        </section>

        { /* 权限 / 支持 */ }
        <section className="space-y-3">
          <SectionTitle>权限与能力</SectionTitle>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" leftIcon={ <ShieldCheck size={ 16 } /> } onClick={ askPermission }>
              请求权限
            </Button>
            <Button variant="secondary" leftIcon={ <BadgeCheck size={ 16 } /> } onClick={ checkSupport }>
              检测支持
            </Button>
          </div>
        </section>

        { /* 事件日志 */ }
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>事件日志</SectionTitle>
            <Button variant="ghost" size="sm" leftIcon={ <Trash2 size={ 14 } /> } onClick={ clearLogs }>
              清空
            </Button>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-2xl bg-background2 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
            { logs.length === 0
              ? (
                <p className="px-4 py-8 text-center text-sm text-text3">
                  暂无事件，点击上方按钮试试
                </p>
              )
              : (
                <ul className="divide-y divide-border/60">
                  { logs.map((log) => <LogRow key={ log.id } log={ log } />) }
                </ul>
              ) }
          </div>
        </section>
      </div>
    </div>
  )
}

function EnvCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background px-4 py-3">
      <div className="text-xs text-text3">{ label }</div>
      <div className="mt-0.5 truncate text-sm font-medium text-text">
        { value }
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-medium text-text3">
      { children }
    </h2>
  )
}

function LogRow({ log }: { log: NotifyLog }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="shrink-0 font-mono text-xs text-text3">
        { log.time }
      </span>
      <span
        className={ [
          'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
          KIND_STYLE[log.kind],
        ].join(' ') }
      >
        { log.type }
      </span>
      { log.detail && <span className="truncate text-text2">{ log.detail }</span> }
    </li>
  )
}

const KIND_STYLE: Record<NotifyLog['kind'], string> = {
  send: 'bg-infoBg text-info',
  event: 'bg-successBg text-success',
  action: 'bg-background3 text-text2',
  error: 'bg-dangerBg text-danger',
}
