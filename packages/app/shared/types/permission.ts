import type { MediaAccessStatus } from './media'

/**
 * 统一权限类型
 * - microphone / camera / screen 走 systemPreferences 媒体权限
 * - accessibility 走 systemPreferences.isTrustedAccessibilityClient（Fn 长按 / 划词等）
 */
export type PermissionKind = 'microphone' | 'camera' | 'screen' | 'accessibility'

/**
 * 统一权限状态，与媒体权限状态保持一致
 * - accessibility 只会返回 'granted' | 'denied'（macOS 无 not-determined 概念）
 */
export type PermissionStatus = MediaAccessStatus
