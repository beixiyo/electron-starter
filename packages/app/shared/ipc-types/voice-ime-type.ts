export type VoiceImeReleaseResult = {
  duration: number
  mimeType: string
  size: number
  audioBuffer: ArrayBuffer
} | {
  error: string
  duration: number
}
