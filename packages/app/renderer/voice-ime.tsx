import { createRoot } from 'react-dom/client'

import { VoiceImeApp } from './VoiceImeApp'
import 'styles/css/index.css'

createRoot(document.getElementById('root')!).render(
  <VoiceImeApp />,
)
