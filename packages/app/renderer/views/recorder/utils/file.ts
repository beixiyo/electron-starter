/**
 * 将文件名中的非法字符替换为短横线，避免保存失败
 */
export const sanitizeFileName = (value: string) => value.replace(/[\\/:*?"<>|]/g, '-')
