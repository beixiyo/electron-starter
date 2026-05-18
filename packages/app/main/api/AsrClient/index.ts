/**
 * 火山引擎 ASR（自动语音识别）客户端
 * @link https://www.volcengine.com/docs/6561/80816?lang=zh
 */

// "dependencies": {
//   "pako": "^2.1.0",
//   "ws": "^8.18.3"
// },
// "devDependencies": {
//   "@types/pako": "^2.0.4",
//   "@types/ws": "^8.18.1"
// }

import type { AsrClientOptions, AsrResponse, AudioCodec, AudioFormat, AudioLanguage, ResultType } from './asrTypes'
import pako from 'pako'
import { WebSocket } from 'ws'
import { ASR_SUCCESS_CODE, DefaultAudioOnlyWsHeader, DefaultFullClientWsHeader, DefaultLastAudioWsHeader, MessageType } from './asrTypes'

export class AsrClient {
  private config: Required<AsrClientOptions> = {
    appid: '',
    token: '',
    cluster: 'volcengine_input_common',
    workflow: 'audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate',
    format: 'wav' as AudioFormat,
    codec: 'raw' as AudioCodec,
    segSize: 160000,
    url: 'wss://openspeech.bytedance.com/api/v2/asr',
    rate: 16000,
    language: 'zh-CN' as AudioLanguage,
    bits: 16,
    channel: 1,
    nbest: 1,
    showLanguage: false,
    showUtterances: false,
    resultType: 'full' as ResultType,
    uid: crypto.randomUUID(),
    timeout: 60000,
  }

  constructor(options: AsrClientOptions) {
    this.config = {
      ...this.config,
      ...options,
    }
  }

  /**
   * 请求音频数据的 ASR 转录
   * @param audioData - 音频数据，ArrayBuffer 或 Uint8Array 格式
   * @returns 解析为 AsrResponse 的 Promise
   */
  async requestAsr(audioData: ArrayBuffer | Uint8Array): Promise<AsrResponse> {
    /** 如需要，转换为 Uint8Array */
    const audioBytes = audioData instanceof ArrayBuffer
      ? new Uint8Array(audioData)
      : audioData

    const headers: Record<string, string> = {
      Authorization: `Bearer; ${this.config.token}`,
    }
    const ws = new WebSocket(this.config.url, {
      headers,
    })

    ws.binaryType = 'arraybuffer'

    return new Promise((resolve, reject) => {
      let isResolved = false
      let isRejected = false
      const audioSegments: Array<{ data: Uint8Array, isLast: boolean }> = []
      let currentSegmentIndex = 0
      let sentSegmentCount = 0 // 已发送的片段数量
      let receivedResponseCount = 0 // 已收到的响应数量（不包括 full request 响应）
      let fullRequestResponseReceived = false
      let timeoutTimer: NodeJS.Timeout | null = null

      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
          timeoutTimer = null
        }
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
      }

      const handleTimeout = () => {
        if (!isResolved && !isRejected) {
          isRejected = true
          cleanup()
          ws.close()
          reject(new Error(`ASR 请求超时（${this.config.timeout}ms），已发送 ${sentSegmentCount} 个音频片段，收到 ${receivedResponseCount} 个响应`))
        }
      }

      const resetTimeout = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
        }
        timeoutTimer = setTimeout(handleTimeout, this.config.timeout)
      }

      const handleError = (event: WebSocket.ErrorEvent) => {
        if (isRejected)
          return
        isRejected = true
        cleanup()
        reject(new Error(`WebSocket 错误: ${event.message || event}`))
      }

      const handleClose = (event: WebSocket.CloseEvent) => {
        cleanup()
        if (!isResolved && !isRejected) {
          /** 如果正常关闭（code=1000）但还没有收到最终结果，尝试返回已保存的结果 */
          if (event.code === 1000 && lastResultResponse) {
            isResolved = true
            resolve(lastResultResponse)
          }
          else if (event.code !== 1000) {
            isRejected = true
            reject(new Error(`WebSocket 连接关闭，代码: ${event.code}, 原因: ${event.reason}`))
          }
          else {
            /** 正常关闭但没有结果，可能是服务器提前关闭 */
            isRejected = true
            reject(new Error(`WebSocket 正常关闭，但未收到最终识别结果`))
          }
        }
      }

      const sendNextAudioSegment = () => {
        if (currentSegmentIndex >= audioSegments.length) {
          /** 所有音频片段已发送完成 */
          return
        }

        const segment = audioSegments[currentSegmentIndex]
        const isLast = segment.isLast
        const dataSlice = segment.data

        const compressedData = this.gzipCompress(dataSlice)
        const dataSize = compressedData.length
        const dataSizeArr = new Uint8Array(4)
        new DataView(dataSizeArr.buffer).setUint32(0, dataSize, false) // 大端字节序

        const header = isLast
          ? DefaultLastAudioWsHeader
          : DefaultAudioOnlyWsHeader
        const audioMsg = new Uint8Array(header.length + 4 + compressedData.length)
        audioMsg.set(header, 0)
        audioMsg.set(dataSizeArr, header.length)
        audioMsg.set(compressedData, header.length + 4)

        ws.send(audioMsg)
        currentSegmentIndex++
        sentSegmentCount++
        resetTimeout() // 重置超时计时器
      }

      let lastResultResponse: AsrResponse | null = null

      const handleMessage = async (event: WebSocket.MessageEvent) => {
        try {
          resetTimeout() // 每次收到响应都重置超时计时器

          const response = await this.parseResponse(event.data as ArrayBuffer, false)

          /** 调试：打印响应信息 */
          console.log('收到响应:', {
            code: response.code,
            message: response.message,
            sequence: response.sequence,
            hasResults: !!(response.results && response.results.length > 0),
            resultsCount: response.results?.length || 0,
          })

          /** 检查响应是否表示错误 */
          if (response.code !== undefined && response.code !== ASR_SUCCESS_CODE) {
            if (!isRejected) {
              isRejected = true
              cleanup()
              ws.close()
              reject(new Error(`ASR 请求失败，代码 ${response.code}: ${response.message || '未知错误'}`))
            }
            return
          }

          /** 如果响应包含结果（result 或 results 字段），保存它 */
          const hasResults = (response.result && response.result.length > 0) || (response.results && response.results.length > 0)
          if (hasResults) {
            console.log('找到包含结果的响应，保存')
            /** 统一处理：如果只有 result，也设置 results 以便后续使用 */
            if (response.result && !response.results) {
              response.results = response.result
            }
            lastResultResponse = response
          }
          else if (response.code === ASR_SUCCESS_CODE) {
            /**
             * 如果没有 results 但响应成功，也保存它（可能是最终响应）
             * 但优先使用包含 results 的响应
             */
            const lastHasResults = (lastResultResponse?.result && lastResultResponse.result.length > 0)
              || (lastResultResponse?.results && lastResultResponse.results.length > 0)
            if (!lastResultResponse || !lastHasResults) {
              lastResultResponse = response
            }
          }

          if (!fullRequestResponseReceived) {
            /** 这是 full request 的响应，现在开始发送音频片段 */
            fullRequestResponseReceived = true
            if (audioSegments.length > 0) {
              sendNextAudioSegment()
            }
            else {
              /** 没有音频片段，直接返回结果 */
              if (!isResolved) {
                isResolved = true
                cleanup()
                ws.close()
                resolve(lastResultResponse || response)
              }
            }
          }
          else {
            /** 这是音频片段的响应 */
            receivedResponseCount++

            /** 检查是否所有片段都已发送且收到响应 */
            if (sentSegmentCount >= audioSegments.length && receivedResponseCount >= sentSegmentCount) {
              /** 所有音频片段已发送并收到响应，返回最终结果 */
              if (!isResolved) {
                isResolved = true
                cleanup()
                ws.close()
                /** 返回包含结果的响应，如果没有则返回最后一个响应 */
                resolve(lastResultResponse || response)
              }
            }
            else if (currentSegmentIndex < audioSegments.length) {
              /** 继续发送下一个音频片段 */
              sendNextAudioSegment()
            }
            /**
             * 如果还有未发送的片段但已收到响应，等待下一个响应或继续发送
             * 这种情况可能发生在服务器快速响应的情况下
             */
          }
        }
        catch (error) {
          if (!isRejected) {
            isRejected = true
            cleanup()
            ws.close()
            reject(error)
          }
        }
      }

      ws.onerror = handleError
      ws.onclose = handleClose
      ws.onmessage = handleMessage

      ws.onopen = async () => {
        try {
          /** 启动超时计时器 */
          resetTimeout()

          /** 准备音频片段 */
          for (let sentSize = 0; sentSize < audioBytes.length; sentSize += this.config.segSize) {
            const isLastAudio = sentSize + this.config.segSize >= audioBytes.length
            const dataSlice = isLastAudio
              ? audioBytes.slice(sentSize)
              : audioBytes.slice(sentSize, sentSize + this.config.segSize)
            audioSegments.push({ data: dataSlice, isLast: isLastAudio })
          }

          // 1. 发送完整客户端请求
          const req = this.constructRequest()
          const payload = this.gzipCompress(req)
          const payloadSize = payload.length
          const payloadSizeArr = new Uint8Array(4)
          new DataView(payloadSizeArr.buffer).setUint32(0, payloadSize, false) // 大端字节序

          const fullClientMsg = new Uint8Array(DefaultFullClientWsHeader.length + payloadSizeArr.length + payload.length)
          fullClientMsg.set(DefaultFullClientWsHeader, 0)
          fullClientMsg.set(payloadSizeArr, DefaultFullClientWsHeader.length)
          fullClientMsg.set(payload, DefaultFullClientWsHeader.length + payloadSizeArr.length)

          ws.send(fullClientMsg)
          /** 等待响应后再发送音频片段（在 handleMessage 中处理） */
        }
        catch (error) {
          if (!isRejected) {
            isRejected = true
            cleanup()
            ws.close()
            reject(error)
          }
        }
      }
    })
  }

  /**
   * 构造初始请求负载
   * @returns 请求的 JSON 字符串
   */
  private constructRequest(): Uint8Array {
    const reqid = crypto.randomUUID()
    const req = {
      app: {
        appid: this.config.appid,
        cluster: this.config.cluster,
        token: this.config.token,
      },
      user: {
        uid: this.config.uid,
      },
      request: {
        reqid,
        nbest: this.config.nbest,
        workflow: this.config.workflow,
        show_language: this.config.showLanguage,
        show_utterances: this.config.showUtterances,
        result_type: this.config.resultType,
        sequence: 1,
      },
      audio: {
        format: this.config.format,
        rate: this.config.rate,
        language: this.config.language,
        bits: this.config.bits,
        channel: this.config.channel,
        codec: this.config.codec,
      },
    }

    const reqStr = JSON.stringify(req)
    return new TextEncoder().encode(reqStr)
  }

  /**
   * 解析服务器的响应
   * @param data - 服务器的原始响应数据
   * @param verbose - 是否打印详细日志
   * @returns 解析的 AsrResponse
   */
  private async parseResponse(data: ArrayBuffer, verbose: boolean = true): Promise<AsrResponse> {
    const msg = new Uint8Array(data)

    /** 解析头信息 */
    const headerSize = msg[0] & 0x0F
    const messageType = msg[1] >> 4
    const messageTypeSpecificFlags = msg[1] & 0x0F
    const serializationMethod = msg[2] >> 4
    const messageCompression = msg[2] & 0x0F
    const reserved = msg[3]
    const headerExtensions = msg.slice(4, headerSize * 4)
    const payload = msg.slice(headerSize * 4)

    /** 打印所有头信息（仅在 verbose 模式下） */
    if (verbose) {
      console.log('=== 响应头信息 ===')
      console.log('头大小:', headerSize)
      console.log('消息类型:', messageType, `(${MessageType[messageType] || '未知'})`)
      console.log('消息类型特定标志:', messageTypeSpecificFlags)
      console.log('序列化方法:', serializationMethod, serializationMethod === 1
        ? '(JSON)'
        : serializationMethod === 0
          ? '(无序列化)'
          : '(其他)')
      console.log('消息压缩:', messageCompression, messageCompression === 1
        ? '(GZIP)'
        : '(无压缩)')
      console.log('保留字段:', reserved)
      console.log('头扩展:', Array.from(headerExtensions))
      console.log('原始数据大小:', data.byteLength, '字节')
      console.log('负载大小:', payload.length, '字节')
    }

    let payloadMsg = new Uint8Array(0)
    let payloadSize = 0

    if (messageType === MessageType.SERVER_FULL_RESPONSE) {
      if (verbose)
        console.log('--- 服务器完整响应 ---')
      payloadSize = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false) // 大端字节序
      payloadMsg = payload.slice(4)
      if (verbose)
        console.log('负载大小:', payloadSize)
    }
    else if (messageType === MessageType.SERVER_ACK) {
      if (verbose)
        console.log('--- 服务器确认响应 ---')
      const seq = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false) // 大端字节序
      if (verbose)
        console.log('服务器确认序列:', seq)
      if (payload.length >= 8) {
        payloadSize = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(4, false) // 大端字节序
        payloadMsg = payload.slice(8)
        if (verbose)
          console.log('负载大小:', payloadSize)
      }
      else {
        if (verbose)
          console.log('无负载数据')
      }
    }
    else if (messageType === MessageType.SERVER_ERROR_RESPONSE) {
      if (verbose)
        console.log('--- 服务器错误响应 ---')
      const code = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false) // 大端字节序
      payloadSize = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(4, false) // 大端字节序
      payloadMsg = payload.slice(8)
      if (verbose)
        console.log('服务器错误响应代码:', code)
      if (verbose)
        console.log('负载大小:', payloadSize)
    }
    else {
      if (verbose)
        console.log('--- 未知消息类型 ---')
      if (verbose)
        console.log('消息类型值:', messageType)
    }

    if (payloadSize === 0 && messageType !== MessageType.SERVER_ACK) {
      if (verbose)
        console.log('警告: 负载大小为 0')
      /** 对于 ACK 消息，payloadSize 可能为 0，这是正常的 */
      if (messageType !== MessageType.SERVER_ACK) {
        throw new Error('负载大小为 0')
      }
    }

    /** 如需要，解压缩 */
    if (messageCompression === 1 && payloadMsg.length > 0) { // GZIP 压缩
      if (verbose)
        console.log('解压缩前负载大小:', payloadMsg.length, '字节')
      try {
        payloadMsg = pako.ungzip(payloadMsg)
        if (verbose)
          console.log('解压缩后负载大小:', payloadMsg.length, '字节')
      }
      catch (error) {
        if (verbose)
          console.error('解压缩负载失败:', error)
        throw error
      }
    }
    else if (verbose) {
      console.log('无需解压缩，负载大小:', payloadMsg.length, '字节')
    }

    /** 根据序列化方法反序列化 */
    if (serializationMethod === 1 && payloadMsg.length > 0) { // JSON
      const decoder = new TextDecoder()
      const jsonString = decoder.decode(payloadMsg)
      if (verbose) {
        console.log('--- JSON 响应内容 ---')
        console.log('原始 JSON 字符串:', jsonString)
      }

      const asrResponse: AsrResponse = JSON.parse(jsonString)
      if (verbose) {
        console.log('解析后的响应对象:')
        console.log(JSON.stringify(asrResponse, null, 2))
      }

      /** 检查响应是否表示成功（但不在 parseResponse 中抛出错误，让调用者处理） */
      if (verbose && asrResponse.code !== undefined && asrResponse.code !== ASR_SUCCESS_CODE) {
        console.error('ASR 请求失败，代码:', asrResponse.code, '消息:', asrResponse.message || '未知错误')
      }

      if (verbose)
        console.log('=== 响应解析完成 ===')
      return asrResponse
    }

    /** 对于 ACK 消息，可能没有 payload，返回一个基本的响应 */
    if (messageType === MessageType.SERVER_ACK) {
      return {
        code: ASR_SUCCESS_CODE,
        message: 'ACK',
        reqid: '',
        sequence: 0,
      }
    }

    if (verbose)
      console.error('不支持的序列化方法:', serializationMethod)
    throw new Error('不支持的序列化方法')
  }

  /**
   * 使用 GZIP 压缩数据
   * @param input - 要压缩的输入数据
   * @returns 压缩后的数据
   */
  gzipCompress(input: Uint8Array): Uint8Array {
    return pako.gzip(input)
  }

  /**
   * 使用 GZIP 解压缩数据
   * @param input - 要解压缩的输入数据
   * @returns 解压缩后的数据
   */
  gzipDecompress(input: Uint8Array): Uint8Array {
    return pako.ungzip(input)
  }
}

export * from './asrTypes'
