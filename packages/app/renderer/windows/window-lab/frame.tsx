/** Window Lab 隔离 frame：只接收同源的可见场景消息。 */

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import '@/tailwind.css'
import { getWindowLabApi } from './ipc'
import { isWindowLabPreview, isWindowLabPreviewMessage, parseWindowLabPreview } from './preview'
import type { WindowLabPreview } from './types'
import { WindowLabPreviewFrame } from './WindowLabPreviewFrame'

const rootElement = document.getElementById('root')!
document.documentElement.classList.add('size-full', 'overflow-hidden')
document.body.classList.add('size-full', 'overflow-hidden')
rootElement.classList.add('size-full', 'overflow-hidden')

const hotState = globalThis as typeof globalThis & { __windowLabFrameRoot?: Root }
const root = hotState.__windowLabFrameRoot ?? createRoot(rootElement)
hotState.__windowLabFrameRoot = root
let active = true

type FrameProps = { initialPreview: WindowLabPreview }

function WindowLabFrameRoot({ initialPreview }: FrameProps) {
  const [preview, setPreview] = useState(initialPreview)

  useEffect(() => {
    const api = getWindowLabApi()
    if (api?.on && window.top === window) {
      return api.on('previewChanged', (value) => {
        if (isWindowLabPreview(value)) setPreview(value)
      })
    }

    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin
        || event.source !== window.parent
        || !isWindowLabPreviewMessage(event.data)
      ) return
      setPreview(event.data.preview)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', preview.theme === 'dark')
    return () => document.documentElement.classList.remove('dark')
  }, [preview.theme])

  return <WindowLabPreviewFrame preview={ preview } />
}

function readInitialPreview(): WindowLabPreview {
  return parseWindowLabPreview(window.location.search)
}

async function main(): Promise<void> {
  const api = getWindowLabApi()
  const initialPreview = api?.getPreview && window.top === window
    ? await Promise.resolve(api.getPreview()).then((value) => value ?? readInitialPreview()).catch(() => readInitialPreview())
    : readInitialPreview()
  if (active) root.render(<WindowLabFrameRoot initialPreview={ initialPreview } />)
}

void main()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    active = false
    root.unmount()
    delete hotState.__windowLabFrameRoot
  })
}
