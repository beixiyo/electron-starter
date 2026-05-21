import { createRoot } from 'react-dom/client'

import { ShortcutTestApp } from './ShortcutTestApp'
import 'styles/css/index.css'

document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'
document.getElementById('root')!.style.background = 'transparent'

createRoot(document.getElementById('root')!).render(
  <ShortcutTestApp />,
)
