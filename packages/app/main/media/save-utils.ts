/**
 * 默认文件扩展名
 */
const DEFAULT_EXTENSION = 'webm' as const

/**
 * MIME 类型到文件扩展名的映射表
 * 使用精确匹配或前缀匹配来确保准确性
 */
const MIME_TYPE_TO_EXTENSION = new Map<string, string>([
  /** 视频格式 */
  ['video/mp4', 'mp4'],
  ['video/x-m4v', 'mp4'],
  ['video/webm', 'webm'],
  ['video/ogg', 'ogg'],
  ['video/ogv', 'ogv'],
  /** 音频格式 */
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/mp4', 'm4a'],
  ['audio/x-m4a', 'm4a'],
  ['audio/wav', 'wav'],
  ['audio/wave', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/ogg', 'ogg'],
  ['audio/oga', 'oga'],
  ['audio/webm', 'webm'],
])

/**
 * 根据录制的 MIME 类型推断扩展名
 * @param mimeType MIME 类型，例如 'video/mp4', 'audio/mpeg' 等
 * @returns 文件扩展名（不含点号），默认为 'webm'
 */
export function resolveExtension(mimeType?: string): string {
  if (!mimeType) {
    return DEFAULT_EXTENSION
  }

  /** 精确匹配 */
  const exactMatch = MIME_TYPE_TO_EXTENSION.get(mimeType)
  if (exactMatch) {
    return exactMatch
  }

  /** 前缀匹配（处理带参数的 MIME 类型，如 'video/mp4; codecs="avc1.42E01E"'） */
  const normalizedMimeType = mimeType.split(';')[0].trim()
  const prefixMatch = MIME_TYPE_TO_EXTENSION.get(normalizedMimeType)
  if (prefixMatch) {
    return prefixMatch
  }

  /** 回退到默认扩展名 */
  return DEFAULT_EXTENSION
}
