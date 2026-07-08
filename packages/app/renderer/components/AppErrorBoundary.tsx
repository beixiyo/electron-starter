import { memo } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'

export const AppErrorBoundary = memo<AppErrorBoundaryProps>((props) => {
  const {
    children,
    className,
  } = props

  return (
    <ErrorBoundary
      fallbackRender={ fallbackProps => (
        <AppErrorFallback
          { ...fallbackProps }
          className={ className }
        />
      ) }
      onError={ (error, info) => {
        console.error('[AppErrorBoundary]', error, info.componentStack)
      } }
    >
      { children }
    </ErrorBoundary>
  )
})

AppErrorBoundary.displayName = 'AppErrorBoundary'

const AppErrorFallback = memo<AppErrorFallbackProps>((props) => {
  const {
    className,
    resetErrorBoundary,
  } = props
  const { t } = useTranslation('common')

  return (
    <div
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

export type AppErrorBoundaryProps = {
  className?: string
}
& React.PropsWithChildren

type AppErrorFallbackProps = {
  className?: string
  resetErrorBoundary: () => void
}
