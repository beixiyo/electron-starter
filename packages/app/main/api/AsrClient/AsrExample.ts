/**
 * ASR 客户端使用示例
 */

import { AsrClient } from '.'

async function example() {
  /**
   * ⚠️ 重要提示：WebM 格式文件需要先转换为 WAV 或 OGG 格式
   *
   * WebM 虽然包含 Opus 编码，但它是 Matroska 容器格式，火山引擎可能无法直接处理。
   * 建议使用 ffmpeg 转换：
   *
   * 转换为 WAV（推荐，最稳定）：
   *   ffmpeg -i download.weba -ar 16000 -ac 1 -f wav download.wav
   *
   * 转换为 OGG：
   *   ffmpeg -i download.weba -c:a libopus -ar 48000 -ac 1 download.ogg
   *
   * 然后使用转换后的文件进行识别。
   */

  try {
    /**
     * 加载音频文件（用于 Node.js 环境）
     * 在浏览器中，您会以不同的方式获取音频数据
     *
     * ⚠️ 注意：WebM 格式文件需要先转换为 WAV 或 OGG 格式
     */
    let audioData: Buffer
    let client: AsrClient

    if (typeof window === 'undefined') {
      // Node.js 环境
      const fs = await import('node:fs')
      const wavFile = './download.wav'
      const webaFile = './download.weba'

      if (fs.existsSync(wavFile)) {
        console.log('使用转换后的 WAV 文件:', wavFile)
        audioData = fs.readFileSync(wavFile)
        // WAV 格式配置
        client = new AsrClient({
          appid: process.env.ASR_APPID || 'xxx',
          token: process.env.ASR_TOKEN || 'xxx',
          cluster: process.env.ASR_CLUSTER || 'xxx',
          format: 'wav',
          codec: 'raw',
          rate: 16000,
          segSize: 160000,
        })
      }
      else if (fs.existsSync(webaFile)) {
        console.warn('⚠️  警告：检测到 WebM 文件')
        console.warn('   WebM 格式可能无法被火山引擎直接处理')
        console.warn('   建议先转换为 WAV: ffmpeg -i download.weba -ar 16000 -ac 1 -f wav download.wav')
        console.warn('   或转换为 OGG: ffmpeg -i download.weba -c:a libopus -ar 48000 -ac 1 download.ogg')
        console.warn('   正在尝试使用 OGG 配置处理 WebM 文件...')
        audioData = fs.readFileSync(webaFile)
        /** 尝试使用 OGG/Opus 配置处理 WebM */
        client = new AsrClient({
          appid: import.meta.env.MAIN_VITE_ASR_APPID || '',
          token: import.meta.env.MAIN_VITE_ASR_TOKEN || '',
          cluster: import.meta.env.MAIN_VITE_ASR_CLUSTER || '',
          format: 'ogg',
          codec: 'opus',
          rate: 48000,
          segSize: 480000,
        })
      }
      else {
        throw new Error('未找到音频文件。请先转换 WebM 文件为 WAV 格式。')
      }
    }
    else {
      /** 浏览器环境 - 您通常从以下来源获取音频数据： */
      // - 音频文件输入元素
      // - 通过 MediaRecorder API 录制音频
      // - 来自麦克风的音频
      /** 在此示例中，我们将展示如何使用文件输入： */

      // const fileInput = document.getElementById('audio-file') as HTMLInputElement
      // const file = fileInput.files?.[0]
      // if (file) {
      //   audioData = await file.arrayBuffer()
      // } else {
      //   throw new Error('未提供音频文件')
      // }

      /** 在此示例中，我们将跳过浏览器执行 */
      console.log('检测到浏览器环境。请从文件输入或录音中提供音频数据。')
      return
    }

    /** 替代方案：如果您有来自其他来源的 ArrayBuffer 或 Uint8Array 格式的音频数据 */
    // const audioData: ArrayBuffer = ... // 您的音频数据源

    console.log('开始 ASR 转录...')
    const result = await client.requestAsr(audioData)

    console.log('ASR 响应:')
    console.log('请求 ID:', result.reqid)
    console.log('代码:', result.code)
    console.log('消息:', result.message)
    console.log('序列:', result.sequence)
    console.log('完整响应:', JSON.stringify(result, null, 2))

    /** 支持 result（单数）和 results（复数）字段 */
    const results = result.results || result.result || []
    if (results.length > 0) {
      console.log('转录结果:')
      results.forEach((res, index) => {
        console.log(`结果 ${index + 1}:`)
        console.log('  文本:', res.text)
        console.log('  置信度:', res.confidence)
        if (res.language) {
          console.log('  语言:', res.language)
        }
        if (res.utterances && res.utterances.length > 0) {
          console.log('  话语:')
          res.utterances.forEach((utt, uttIndex) => {
            console.log(`    话语 ${uttIndex + 1}:`)
            console.log('      文本:', utt.text)
            console.log('      开始时间:', utt.startTime)
            console.log('      结束时间:', utt.endTime)
            console.log('      确定:', utt.definite)
            if (utt.language) {
              console.log('      语言:', utt.language)
            }
            if (utt.words && utt.words.length > 0) {
              console.log('      词汇:')
              utt.words.forEach((word, wordIndex) => {
                console.log(`        词汇 ${wordIndex + 1}:`)
                console.log('          文本:', word.text)
                console.log('          开始时间:', word.startTime)
                console.log('          结束时间:', word.endTime)
                console.log('          发音:', word.pronounce)
                console.log('          静音时长:', word.blankDuration)
              })
            }
          })
        }
      })
    }
  }
  catch (error) {
    console.error('ASR 转录过程中出错:', error)
  }
}

example()
