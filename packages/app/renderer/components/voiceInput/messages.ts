/** 把主进程门禁语义码转换为独立于转写失败的提示。 */
export function getVoiceInputPromptMessage(code: string): string {
  switch (code) {
    case 'recording':
    case 'recordingBusy': return 'Pause the active recording before using voice input.'
    case 'session':
    case 'sessionBusy': return 'Voice input is already active.'
    case 'capture':
    case 'captureBlocked': return 'Finish the screenshot before using voice input.'
    case 'offline': return 'Connect to the internet before using voice input.'
    case 'disk':
    case 'diskUnavailable': return 'There is not enough available storage for voice input.'
    case 'permission':
    case 'permissionRequired': return 'Allow microphone access to use voice input.'
    default: return code
  }
}
