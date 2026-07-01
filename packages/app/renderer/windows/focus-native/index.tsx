import { createRoot } from 'react-dom/client'

import { FocusNativeApp } from './FocusNativeApp'
import 'styles/css/index.css'

const windowBackground = 'transparent'

document.documentElement.style.background = windowBackground
document.documentElement.style.overflow = 'hidden'
document.body.style.background = windowBackground
document.body.style.overflow = 'hidden'
document.getElementById('root')!.style.background = windowBackground

createRoot(document.getElementById('root')!).render(
  <FocusNativeApp />,
)
