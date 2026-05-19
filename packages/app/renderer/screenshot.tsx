import { createRoot } from 'react-dom/client'

import { ScreenshotApp } from './ScreenshotApp'
import 'styles/css/index.css'

createRoot(document.getElementById('root')!).render(
  <ScreenshotApp />,
)
