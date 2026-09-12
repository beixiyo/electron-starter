/** 界面语言归一化与跨窗口同步；只加载模板已有的资源语言。 */
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { applyDocumentLang } from '@/utils/documentLang'
import { resources, SupportedLanguages } from './lang'

/** 与现有语言偏好兼容的存储键。 */
export const I18N_STORAGE_KEY = 'i18n:language'

/** 将浏览器语言码归一到实际资源；未知语言回落英文，空值保留模板中文默认值。 */
export function normalizeLanguage(language?: string | null): SupportedLanguages {
  const value = language?.trim().replace(/_/g, '-').toLowerCase()
  if (!value || value === 'zh' || value.startsWith('zh-'))
    return SupportedLanguages.ZH_CN
  return SupportedLanguages.EN_US
}

i18n.use(LanguageDetector).use(initReactI18next).init({
  debug: false,
  fallbackLng: SupportedLanguages.EN_US,
  load: 'currentOnly',
  supportedLngs: Object.values(SupportedLanguages),
  interpolation: { escapeValue: false },
  detection: {
    order: ['localStorage', 'navigator', 'querystring', 'cookie'],
    lookupLocalStorage: I18N_STORAGE_KEY,
    caches: ['localStorage'],
    convertDetectedLanguage: normalizeLanguage,
  },
  resources,
})

applyDocumentLang(i18n.language)
const channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('i18n-language')
  : null
let incomingLanguage: string | null = null
const onLanguageChanged = (language: string) => {
  const normalized = normalizeLanguage(language)
  if (normalized !== language) {
    void i18n.changeLanguage(normalized)
    return
  }
  applyDocumentLang(normalized)
  if (incomingLanguage !== normalized)
    channel?.postMessage(normalized)
}
i18n.on('languageChanged', onLanguageChanged)
if (channel) {
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string')
      return
    /** 偏好已由检测器持久化；读取最新值，避免排队的旧广播覆盖后一次选择。 */
    let latest = event.data
    try {
      latest = localStorage.getItem(I18N_STORAGE_KEY) ?? latest
    }
    catch {
      /** 存储不可用时仍可通过广播同步本次选择。 */
    }
    const next = normalizeLanguage(latest)
    if (next !== i18n.language) {
      incomingLanguage = next
      void i18n.changeLanguage(next).finally(() => {
        if (incomingLanguage === next)
          incomingLanguage = null
      })
    }
  }
}
import.meta.hot?.dispose(() => {
  i18n.off('languageChanged', onLanguageChanged)
  channel?.close()
})

/** 切换到受支持的资源语言，并同步文档、偏好和其他窗口。 */
export const changeLanguage = (language: string) => i18n.changeLanguage(normalizeLanguage(language))
/** 当前界面语言。 */
export const getCurrentLanguage = () => i18n.language
export default i18n
