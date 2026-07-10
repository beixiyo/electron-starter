import { UiohookKey } from 'uiohook-napi'

const keyLookup = buildKeyLookup()
const isMac = process.platform === 'darwin'

const CTRL_KEYS = [UiohookKey.Ctrl, UiohookKey.CtrlRight]
const SHIFT_KEYS = [UiohookKey.Shift, UiohookKey.ShiftRight]
const ALT_KEYS = [UiohookKey.Alt, UiohookKey.AltRight]
const META_KEYS = [UiohookKey.Meta, UiohookKey.MetaRight]

export function resolveKeyGroup(rawToken: string): number[] {
  const normalized = rawToken.replace(/[\s_-]/g, '').toLowerCase()

  switch (normalized) {
    case 'commandorcontrol':
    case 'cmdorctrl':
    case 'cmdorcontrol':
    case 'commandorctrl':
    case 'ctrlorcmd':
    case 'controlorcommand':
      return isMac
        ? META_KEYS
        : CTRL_KEYS
    case 'command':
    case 'cmd':
    case 'meta':
    case 'super':
    case 'win':
    case 'windows':
      return META_KEYS
    case 'control':
    case 'ctrl':
      return CTRL_KEYS
    case 'shift':
      return SHIFT_KEYS
    case 'alt':
    case 'option':
    case 'altgr':
      return ALT_KEYS
    case 'enter':
    case 'return':
      return [UiohookKey.Enter]
    case 'esc':
    case 'escape':
      return [UiohookKey.Escape]
    case 'space':
    case 'spacebar':
      return [UiohookKey.Space]
    case 'plus':
      return [UiohookKey.Equal]
    case 'grave':
      return [UiohookKey.Backquote]
    case 'left':
      return [UiohookKey.ArrowLeft]
    case 'right':
      return [UiohookKey.ArrowRight]
    case 'up':
      return [UiohookKey.ArrowUp]
    case 'down':
      return [UiohookKey.ArrowDown]
    case 'leftbracket':
      return [UiohookKey.BracketLeft]
    case 'rightbracket':
      return [UiohookKey.BracketRight]
  }

  const lookupKey = rawToken.toLowerCase()
  const matched = keyLookup.get(lookupKey)
  if (matched !== undefined) {
    return [matched]
  }

  throw new Error(`暂不支持的快捷键按键: ${rawToken}`)
}

function buildKeyLookup(): Map<string, number> {
  const map = new Map<string, number>()
  for (const [name, code] of Object.entries(UiohookKey)) {
    if (typeof code === 'number') {
      map.set(name.toLowerCase(), code)
    }
  }
  return map
}
