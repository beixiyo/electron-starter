/** 同步界面语言到文档，供字体选择、断词、拼写检查和读屏使用。 */
export function applyDocumentLang(language?: string | null): void {
  const value = language?.trim()
  if (typeof document !== 'undefined' && value)
    document.documentElement.lang = value
}
