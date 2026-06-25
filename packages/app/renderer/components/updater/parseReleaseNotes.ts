/**
 * 解析多语言更新日志
 *
 * 约定格式：用 `[语言码]` 行分段，语言码与 i18n 一致（如 `en-US` / `zh-CN`）：
 *
 * ```md
 * [en-US]
 * - Add in-app update dialog
 * [zh-CN]
 * - 新增应用内更新弹窗
 * ```
 *
 * 取值优先级：精确语言 → 同语系（如 `zh-TW` 回退到任意 `zh-*`）→ 兜底语言（`en-US`）→ 第一段
 * 若整段不含任何 `[xx]` 标记，则视为单语言文件，原样返回（向后兼容）
 *
 * @param raw `UpdateInfoLite.releaseNotes` 原文（来自 latest-mac.yml）
 * @param lang 当前界面语言（`i18n.language`）
 * @param fallbackLang 找不到对应语言时的兜底语言 @default 'en-US'
 */
export function parseReleaseNotes(raw: string | undefined | null, lang: string, fallbackLang = 'en-US'): string {
  const text = (raw ?? '').trim()
  if (!text)
    return ''

  const sections = splitSections(text)
  /** 无任何分段标记 → 单语言文件，原样返回 */
  if (sections.size === 0)
    return text

  return (
    sections.get(lang)
    ?? matchSameBase(sections, lang)
    ?? sections.get(fallbackLang)
    ?? [...sections.values()][0]
    ?? ''
  )
}

/** 按 `[lang]` 标记行切分；返回 语言码 → 内容 的有序 Map */
function splitSections(text: string): Map<string, string> {
  const sections = new Map<string, string>()
  let current: string | null = null
  let buffer: string[] = []

  const flush = () => {
    if (current !== null)
      sections.set(current, buffer.join('\n').trim())
    buffer = []
  }

  for (const line of text.split('\n')) {
    const marker = line.trim().match(/^\[([\w-]+)\]$/)
    if (marker) {
      flush()
      current = marker[1]
    }
    else if (current !== null) {
      buffer.push(line)
    }
  }
  flush()

  return sections
}

/** 同语系回退：`zh-TW` 找不到时匹配任意 `zh-*`（取第一个） */
function matchSameBase(sections: Map<string, string>, lang: string): string | undefined {
  const base = lang.split('-')[0]
  for (const [code, content] of sections) {
    if (code.split('-')[0] === base)
      return content
  }
  return undefined
}
