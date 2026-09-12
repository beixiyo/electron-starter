/** 将模板的各语言 JSON 按文件名整理成 i18next 命名空间。 */
import type { Resource, ResourceLanguage } from 'i18next'

/** 模板当前提供完整资源的语言。 */
export enum SupportedLanguages {
  ZH_CN = 'zh-CN',
  EN_US = 'en-US',
}

/** 已合并的语言资源。 */
export const resources: Resource = {
  [SupportedLanguages.EN_US]: addResource(import.meta.glob('./en-US/*.json', { eager: true, import: 'default' })),
  [SupportedLanguages.ZH_CN]: addResource(import.meta.glob('./zh-CN/*.json', { eager: true, import: 'default' })),
}

function addResource(modules: Record<string, unknown>): ResourceLanguage {
  const result: ResourceLanguage = {}
  for (const [path, resource] of Object.entries(modules)) {
    const namespace = path.split('/').pop()!.replace('.json', '')
    if (namespace !== 'index')
      result[namespace] = resource as ResourceLanguage[string]
  }
  return result
}
