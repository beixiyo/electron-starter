import { createRoot } from 'react-dom/client'

import { ShortcutTestApp } from './ShortcutTestApp'
import 'styles/css/index.css'

createRoot(document.getElementById('root')!).render(
  <ShortcutTestApp />,
)
