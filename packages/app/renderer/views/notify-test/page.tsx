import type { NotifyLog } from './useNotifyDemo'
import { Button } from 'comps'
import {
  BadgeCheck,
  Bell,
  ListChecks,
  MessageSquareReply,
  Pin,
  Repeat2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
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
    <div className="min-h-full bg-zinc-50 px-8 py-10 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl space-y-8">

        {/* 标题 */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            通知测试
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            点击按钮发送通知，下方实时记录各回调事件
          </p>
        </header>

        {/* 环境信息 */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-800">
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

        {/* 发送动作 */}
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

        {/* 权限 / 支持 */}
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

        {/* 事件日志 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>事件日志</SectionTitle>
            <Button variant="ghost" size="sm" leftIcon={ <Trash2 size={ 14 } /> } onClick={ clearLogs }>
              清空
            </Button>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            { logs.length === 0
              ? (
                  <p className="px-4 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
                    暂无事件，点击上方按钮试试
                  </p>
                )
              : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    { logs.map(log => (
                      <LogRow key={ log.id } log={ log } />
                    )) }
                  </ul>
                ) }
          </div>
        </section>

      </div>
    </div>
  )
}

function EnvCell({ label, value }: { label: string, value: string }) {
  return (
    <div className="bg-zinc-50 px-4 py-3 dark:bg-zinc-950">
      <div className="text-xs text-zinc-400 dark:text-zinc-500">{ label }</div>
      <div className="mt-0.5 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
        { value }
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
      { children }
    </h2>
  )
}

function LogRow({ log }: { log: NotifyLog }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="shrink-0 font-mono text-xs text-zinc-400 dark:text-zinc-500">
        { log.time }
      </span>
      <span className={ [
        'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
        KIND_STYLE[log.kind],
      ].join(' ') }
      >
        { log.type }
      </span>
      { log.detail && (
        <span className="truncate text-zinc-600 dark:text-zinc-300">{ log.detail }</span>
      ) }
    </li>
  )
}

const KIND_STYLE: Record<NotifyLog['kind'], string> = {
  send: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300',
  event: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  action: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200',
  error: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300',
}
