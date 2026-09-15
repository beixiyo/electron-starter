/** Fn 组合成员键的窗口内抑制：Fn 按住期间吞掉已绑定的组合键，避免字符落进输入框 */

import type { FnModifier, KeyboardCode, KeyboardInput, KeyboardShortcutModifier, ShortcutBinding } from '@shared/shortcuts'
import type { Input, WebContents } from 'electron'
import type { ShortcutRuntimeEntry } from './runtime-backend'
import { isKeyboardModifierCode, KEYBOARD_MODIFIER_BY_CODE, normalizeBrowserShortcutKey, normalizeShortcutModifier } from '@shared/shortcuts'
import { keyboardInputBackend } from './input'

/**
 * Fn 按住时 macOS 自己会翻译掉的键：绑定写的是物理键，窗口里收到的是翻译结果
 *
 * Apple 键盘驱动在 HID 层就按 `FnKeyboardUsageMap` 改写了这些键，CGEvent 与 Chromium 的 `code`
 * 拿到的都是翻译结果；helper 在 Fn 已按住时按 Swift 侧 `macFnRemappedKeyCodes` 还原成物理键上报
 * （所以绑定与运行时匹配的是 `ArrowLeft` / `Enter`），而 `before-input-event` 只看得到翻译后的
 * `Home` / `NumpadEnter`。不把别名算进来，`Fn+方向键` 这类绑定就会「动作触发了、字符也照样生效」，
 * 正是本模块要修的那个 bug
 *
 * 只做「物理键 → 翻译结果」的单向别名：反过来把 `Home` 也当成 `ArrowLeft` 会让
 * 一个 `Fn+Home` 绑定吞掉 `Fn+ArrowLeft`，而那个组合在运行时并不会触发
 */
const FN_TRANSLATED_KEYS: Readonly<Partial<Record<KeyboardCode, KeyboardCode>>> = {
  ArrowLeft: 'Home',
  ArrowRight: 'End',
  ArrowUp: 'PageUp',
  ArrowDown: 'PageDown',
  Backspace: 'Delete',
  Enter: 'NumpadEnter',
}

let fnDown = false
let entries: SuppressionEntry[] = []
let unsubscribe: (() => void) | null = null

/**
 * 声明当前生效的 Fn 组合成员键
 *
 * 实测症状：`fn+\`` 触发动作的同时，输入框里多出一个反引号；`fn+Space`、`fn+S` 同理，
 * 只是字符不显眼。根因是 macOS 的 keyboard-listener helper 建的 tap 虽为 `.defaultTap`，
 * 回调却恒定 `return Unmanaged.passUnretained(event)`（见 `native/mac/README.md`
 * 「helper 始终透传 CGEvent，不拦截用户输入」），物理键在触发动作之后照样走到聚焦窗口；
 * 渲染进程也补不上这一刀，因为 DOM 拿不到 Fn/Globe，Fn 绑定压根不进浏览器 runtime
 * （见 `renderer/shortcuts/useShortcutRuntime.ts` 的 `isBrowserRuntimeBinding`）
 *
 * 这里的方案边界是**只管本 App 的窗口**：主进程订阅同一条输入流维护 Fn 按住状态，
 * 在 `before-input-event` 里同步裁决。时序可靠 —— Fn 必然先于组合键按下若干毫秒，
 * helper 的 Fn down 早已到达主进程。别的 App 里仍会收到字符，
 * 治本要让 helper 在 tap 层对组合成员键 `return nil`，那需要新增一条 main→helper 的抑制表下行协议
 *
 * 传空数组即撤下抑制并退订输入流
 */
export function setFnComboSuppression(
  runtimeEntries: readonly ShortcutRuntimeEntry[],
  canTrigger: (binding: ShortcutBinding) => boolean,
): void {
  entries = runtimeEntries.flatMap(entry => toSuppressionEntry(entry, canTrigger))

  if (entries.length === 0) {
    stopTracking()
    return
  }

  startTracking()
}

/** 给一个窗口挂上抑制；随窗口销毁一并回收，无需成对调用 */
export function attachFnComboSuppression(webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'keyUp')
      return
    if (!fnDown || entries.length === 0)
      return

    const key = normalizeBrowserShortcutKey({ code: input.code, key: input.key })
    if (!key)
      return

    const modifiers = getInputModifiers(input)
    /** 门禁不通过的绑定不吞键：按下去什么也没发生还吃掉字符，比漏字符更难排查 */
    const matched = entries.some(entry => (
      entry.keys.has(key)
      && sameModifierSet(entry.modifiers, modifiers)
      && entry.canTrigger()
    ))
    if (!matched)
      return

    event.preventDefault()
  })
}

function toSuppressionEntry(
  entry: ShortcutRuntimeEntry,
  canTrigger: (binding: ShortcutBinding) => boolean,
): SuppressionEntry[] {
  const { binding } = entry
  /** 裸 Fn 不产字符，Fn 键自身也不该被吞 */
  if (binding.chord.source !== 'fn' || binding.chord.key === 'Fn')
    return []

  /** `fn + [ + ]` 的每个成员都会落字符，连同各自的翻译结果一并登记 */
  const members = [binding.chord.key, ...(binding.chord.keys ?? [])]
  const keys = new Set<KeyboardCode>()
  for (const member of members) {
    keys.add(member)
    const translated = FN_TRANSLATED_KEYS[member]
    if (translated)
      keys.add(translated)
  }

  return [{
    keys,
    /**
     * modifiers 必须一起比
     *
     * 只看主键的话，绑定 `Fn+Space` 会把 `Fn+Shift+Space` 也吞掉，而那个组合在运行时
     * 并不匹配——用户按下去既没有动作、字符也没了。Electron `Input` 只报家族不分侧别，
     * 因此不管绑定存的是物理侧别还是逻辑家族，都归一到家族粒度再比集合是否完全相同
     */
    modifiers: new Set((binding.chord.modifiers ?? []).map(modifierFamilyOf)),
    canTrigger: () => canTrigger(binding),
  }]
}

/** 物理侧别与逻辑家族统一收敛成家族，用于只有家族粒度的比较场景 */
function modifierFamilyOf(modifier: KeyboardShortcutModifier): FnModifier {
  return isKeyboardModifierCode(modifier)
    ? KEYBOARD_MODIFIER_BY_CODE[modifier]!
    : normalizeShortcutModifier(modifier)
}

function getInputModifiers(input: Input): Set<FnModifier> {
  const modifiers = new Set<FnModifier>()
  if (input.meta)
    modifiers.add('Meta')
  if (input.control)
    modifiers.add('Control')
  if (input.alt)
    modifiers.add('Alt')
  if (input.shift)
    modifiers.add('Shift')

  return modifiers
}

function sameModifierSet(expected: ReadonlySet<FnModifier>, actual: ReadonlySet<FnModifier>): boolean {
  if (expected.size !== actual.size)
    return false

  for (const modifier of expected) {
    if (!actual.has(modifier))
      return false
  }

  return true
}

function startTracking(): void {
  if (unsubscribe)
    return
  unsubscribe = keyboardInputBackend.subscribe(handleInput)
}

function stopTracking(): void {
  fnDown = false
  unsubscribe?.()
  unsubscribe = null
}

/** 只关心 Fn 自身的按住边界；helper 重启或 tap 被禁用时的 reset 一并清掉残留状态 */
function handleInput(input: KeyboardInput): void {
  if (input.phase === 'reset') {
    fnDown = false
    return
  }

  if (input.key !== 'Fn')
    return
  fnDown = input.phase === 'down'
}

type SuppressionEntry = {
  /** 绑定主键与一起按住的成员，外加 macOS 在 Fn 按住时会把它们翻译成的键；见 {@link FN_TRANSLATED_KEYS} */
  keys: ReadonlySet<KeyboardCode>
  /** 绑定要求的逻辑修饰键，已归一掉 `Primary` */
  modifiers: ReadonlySet<FnModifier>
  /** 按键当场复用 runtime 同一套 scope / 权限门禁，避免吞掉不会触发任何动作的键 */
  canTrigger: () => boolean
}
