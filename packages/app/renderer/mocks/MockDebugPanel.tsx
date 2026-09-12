import { useState, useSyncExternalStore } from 'react'
import { getMockDefinitions, getMockRuntimeStatus, subscribeMockDefinitions, subscribeMockRuntimeStatus } from './browser'
import type { MockConfig } from './config'
import { getMockConfig, setMockConfig, setMockEndpointScenario, subscribeMockConfig } from './config'

/** DEV mock 调试面板；内容完全由调用方注入的 endpoint 定义决定。 */
export function MockDebugPanel(props: MockDebugPanelProps = {}): React.JSX.Element | null {
  if (!import.meta.env.DEV) return null

  return <MockDebugPanelContent { ...props } />
}

function MockDebugPanelContent({ className, style }: MockDebugPanelProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const config = useSyncExternalStore(subscribeMockConfig, getMockConfig, getMockConfig)
  const definitions = useSyncExternalStore(subscribeMockDefinitions, getMockDefinitions, getMockDefinitions)
  const status = useSyncExternalStore(subscribeMockRuntimeStatus, getMockRuntimeStatus, getMockRuntimeStatus)
  const activeCount = definitions.filter((definition) => config.endpointScenarios[definition.id] && config.endpointScenarios[definition.id] !== 'off').length

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open mock panel"
        className={ `fixed right-3 top-3 z-9999 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-text shadow-card ${className ?? ''}` }
        style={ style }
        onClick={ () => setOpen(true) }
      >
        Mock
      </button>
    )
  }

  return (
    <aside
      className={ `fixed right-3 top-3 z-9999 w-80 rounded-xl border border-border bg-background p-3 text-xs text-text shadow-card ${className ?? ''}` }
      style={ style }
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <strong>Mock runtime</strong>
        <span className="text-text3">{ statusLabel(status, activeCount) }</span>
      </div>

      <button
        type="button"
        aria-label="Close mock panel"
        className="absolute right-3 top-3 text-text3"
        onClick={ () => setOpen(false) }
      >
        ×
      </button>

      { status.state === 'unsupported' || status.state === 'error'
        ? <p role="alert" className="mb-3 rounded-lg bg-danger/10 px-2 py-1.5 text-danger">{ status.message }</p>
        : null }

      <label className="mb-3 flex items-center justify-between gap-2">
        <span>Delay</span>
        <select
          aria-label="Mock delay"
          value={ config.delayPreset }
          onChange={ (event) => setMockConfig({ delayPreset: event.target.value as MockConfig['delayPreset'] }) }
        >
          <option value="fast">Fast</option>
          <option value="normal">Normal</option>
          <option value="slow">Slow</option>
        </select>
      </label>

      <label className="mb-3 flex items-center justify-between gap-2">
        <span>Force offline</span>
        <input
          aria-label="Force offline"
          type="checkbox"
          checked={ config.forceOffline }
          onChange={ (event) => setMockConfig({ forceOffline: event.target.checked }) }
        />
      </label>

      { definitions.length === 0
        ? <p className="text-text3">No mock endpoints configured.</p>
        : (
          <div className="flex flex-col gap-2">
            { definitions.map((definition) => (
              <label key={ definition.id } className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate" title={ definition.id }>{ definition.label }</span>
                <select
                  aria-label={ `${definition.label} scenario` }
                  value={ config.endpointScenarios[definition.id] ?? 'off' }
                  onChange={ (event) => setMockEndpointScenario(definition.id, event.target.value) }
                >
                  <option value="off">Off</option>
                  { definition.scenarios.map((scenario) => <option key={ scenario.id } value={ scenario.id }>{ scenario.label }</option>) }
                </select>
              </label>
            )) }
          </div>
        ) }
    </aside>
  )
}

function statusLabel(status: MockRuntimeStatus, activeCount: number): string {
  if (status.state === 'error' || status.state === 'unsupported') return status.state
  if (status.state === 'running') return `${activeCount} active`
  return status.state
}

/** 可覆盖调试面板或收起入口的外观。 */
export type MockDebugPanelProps = {
  className?: string
  style?: React.CSSProperties
}

type MockRuntimeStatus = ReturnType<typeof getMockRuntimeStatus>
