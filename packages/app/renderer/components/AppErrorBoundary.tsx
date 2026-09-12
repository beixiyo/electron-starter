/** 按界面范围隔离渲染异常，提供重试与开发期故障注入。 */
import { createRendererFeatureLogger } from '@/logging'
import { memo, useEffect, useMemo, useState } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'

const log = createRendererFeatureLogger('renderer.global')
const MAX_COMPONENT_STACK_LENGTH = 4000

export const AppErrorBoundary = memo<AppErrorBoundaryProps>((props) => {
  const {
    children,
    scope = 'app-root',
    className,
    compact = false,
  } = props
  const [devError, setDevError] = useState<Error | null>(null)
  const resetKeys = useMemo(() => [scope], [scope])

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const registry = getDevErrorBoundaryRegistry()
    const trigger = (message?: string) => {
      setDevError(new Error(message || `Dev render crash: ${scope}`))
    }
    registry[scope] = trigger

    window.__appThrowRenderError = (targetScope, message) => {
      const target = getDevErrorBoundaryRegistry()[targetScope]

      if (!target) {
        console.warn('[AppErrorBoundary] scope not found', targetScope, Object.keys(getDevErrorBoundaryRegistry()))
        return false
      }

      target(message)
      return true
    }
    window.__appListErrorBoundaries = () => Object.keys(getDevErrorBoundaryRegistry())

    return () => {
      if (registry[scope] === trigger) delete registry[scope]

      if (Object.keys(registry).length === 0) {
        delete window.__appThrowRenderError
        delete window.__appListErrorBoundaries
      }
    }
  }, [scope])

  return (
    <ErrorBoundary
      resetKeys={ resetKeys }
      onReset={ () => setDevError(null) }
      fallbackRender={ (fallbackProps) => (
        <AppErrorFallback
          { ...fallbackProps }
          scope={ scope }
          className={ className }
          compact={ compact }
        />
      ) }
      onError={ (error, info) => {
        log.error('render.failed', 'React render failed', error, {
          scope,
          componentStack: truncate(info.componentStack ?? ''),
        })
      } }
    >
      <DevErrorBoundaryTrigger error={ devError }>
        { children }
      </DevErrorBoundaryTrigger>
    </ErrorBoundary>
  )
})

AppErrorBoundary.displayName = 'AppErrorBoundary'

const AppErrorFallback = memo<AppErrorFallbackProps>((props) => {
  const {
    error,
    className,
    resetErrorBoundary,
    scope,
    compact,
  } = props
  const { t } = useTranslation('common')

  if (compact) {
    return (
      <div
        role="alert"
        className={ cn(
          'flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 bg-background3 px-1 text-center text-text',
          className,
        ) }
      >
        <div
          className="flex size-7 items-center justify-center rounded-full bg-systemRed/10 text-sm font-medium text-systemRed"
          title={ t('errorBoundary.title') }
        >
          !
        </div>

        <button
          type="button"
          className="rounded-full bg-background px-2 py-1 text-[11px] text-text transition-colors hover:bg-background2"
          onClick={ resetErrorBoundary }
          title={ t('errorBoundary.retry') }
        >
          { t('errorBoundary.retry') }
        </button>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className={ cn(
        'flex min-h-screen w-full items-center justify-center bg-background px-6 py-10 text-textPrimary',
        className,
      ) }
    >
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <h1 className="text-lg font-semibold leading-6">
          { t('errorBoundary.title') }
        </h1>

        <p className="text-sm leading-6 text-textSecondary">
          { t('errorBoundary.description') }
        </p>

        { import.meta.env.DEV && (
          <div className="max-w-90 truncate text-[11px] leading-4 text-text4">
            { scope }
            :
            { getErrorMessage(error) }
          </div>
        ) }

        <button
          type="button"
          onClick={ resetErrorBoundary }
          className={ cn(
            'mt-1 inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium',
            'bg-button text-textSpecial transition-opacity hover:opacity-90',
          ) }
        >
          { t('errorBoundary.retry') }
        </button>
      </div>
    </div>
  )
})

AppErrorFallback.displayName = 'AppErrorFallback'

/** 渲染异常边界的兼容配置。 */
export type AppErrorBoundaryProps =
  & {
    className?: string
    /** 紧凑容器兜底。@default false */
    compact?: boolean
    /** 日志与开发注入的范围标识。@default 'app-root' */
    scope?: string
  }
  & React.PropsWithChildren

type AppErrorFallbackProps = FallbackProps & {
  className?: string
  compact: boolean
  scope: string
}

const DevErrorBoundaryTrigger = memo<DevErrorBoundaryTriggerProps>((props) => {
  const {
    children,
    error,
  } = props

  if (error) throw error

  return children
})

DevErrorBoundaryTrigger.displayName = 'DevErrorBoundaryTrigger'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message

  if (typeof error === 'string') return error

  return 'Unknown render error'
}

function truncate(value: string): string {
  if (value.length <= MAX_COMPONENT_STACK_LENGTH) return value

  return `${value.slice(0, MAX_COMPONENT_STACK_LENGTH)}...`
}

function getDevErrorBoundaryRegistry(): DevErrorBoundaryRegistry {
  window.__appErrorBoundaryRegistry ??= Object.create(null) as DevErrorBoundaryRegistry
  return window.__appErrorBoundaryRegistry
}

type DevErrorBoundaryTriggerProps = React.PropsWithChildren<{
  error: Error | null
}>

type DevErrorBoundaryRegistry = Record<string, (message?: string) => void>

declare global {
  interface Window {
    __appErrorBoundaryRegistry?: DevErrorBoundaryRegistry
    __appListErrorBoundaries?: () => string[]
    __appThrowRenderError?: (scope: string, message?: string) => boolean
  }
}
