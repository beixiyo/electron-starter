import { createRoot } from 'react-dom/client'
import { FloatingStatusPoolApp } from './FloatingStatusPoolApp'
import 'styles/css/index.css'

document.documentElement.style.background = 'transparent'
document.documentElement.style.overflow = 'hidden'
document.body.style.background = 'transparent'
document.body.style.overflow = 'hidden'
document.getElementById('root')!.style.background = 'transparent'

createRoot(document.getElementById('root')!).render(
  <FloatingStatusPoolApp />,
)
