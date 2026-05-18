import { createRoot } from 'react-dom/client'

import SelectionApp from './SelectionApp'
import 'styles/css/index.css'

createRoot(document.getElementById('root')!).render(
  <SelectionApp />,
)
