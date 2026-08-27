import { installWebIpcShim } from '@/utils/ipcWebShim'
import { mountTransparentWindow } from '../shared'
import { GlobalToastApp } from './GlobalToastApp'
import '@/tailwind.css'

installWebIpcShim()
mountTransparentWindow(<GlobalToastApp />)
