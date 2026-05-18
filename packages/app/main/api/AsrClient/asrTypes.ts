/**
 * 火山引擎 ASR（自动语音识别）API 类型定义
 *
 * 此模块包含火山引擎语音识别服务的所有类型定义，包括：
 * - 客户端配置选项（AsrClientOptions）
 * - 服务响应格式（AsrResponse）
 * - 识别结果结构（Result, Utterance, Word）
 * - WebSocket 协议相关类型和枚举
 * - 常量定义和默认配置
 *
 * 主要用途：
 * - 为 ASR 客户端提供完整的类型支持
 * - 确保 API 调用的类型安全
 * - 提供清晰的接口文档和说明
 *
 * @packageDocumentation
 * @version 1.0.0
 * @since 2025-11-27
 */

/**
 * ASR 服务响应接口
 *
 * 表示火山引擎 ASR 服务返回的语音识别结果，包含请求标识、响应状态
 * 和识别到的文本结果等信息。
 */
export interface AsrResponse {
  /** 请求唯一标识符，用于追踪和调试 */
  reqid: string
  /** 响应状态码，1000 表示成功 */
  code: number
  /** 响应消息，描述操作结果或错误信息 */
  message: string
  /** 消息序列号，用于请求响应匹配 */
  sequence: number
  /** 识别结果数组，API 返回的标准字段 */
  result?: Result[]
  /** 识别结果数组，兼容性字段（部分接口可能使用此字段名） */
  results?: Result[]
}

/**
 * ASR 识别结果接口
 *
 * 表示单个语音识别结果，包含识别文本、置信度等信息。
 * 具体包含的字段取决于请求配置（如是否显示语言、话语等）。
 */
export interface Result {
  /** 识别出的文本内容 */
  text: string
  /** 识别结果的置信度分数（0-1之间） */
  confidence: number
  /** 识别的语言类型，仅在请求配置 show_language=true 时返回 */
  language?: string
  /** 详细的话语信息，仅在请求配置 show_utterances=true 时返回 */
  utterances?: Utterance[]
}

/**
 * 话语详情接口
 *
 * 表示识别文本中的单个话语片段，包含时间信息和词汇详情。
 * 用于提供更精细的识别结果展示。
 */
export interface Utterance {
  /** 话语的文本内容 */
  text: string
  /** 话语开始时间（毫秒） */
  startTime: number
  /** 话语结束时间（毫秒） */
  endTime: number
  /** 是否为确定的识别结果 */
  definite: boolean
  /** 组成话语的词汇详情数组 */
  words: Word[]
  /** 话语的语言类型，仅在 show_language=true 时返回 */
  language?: string
}

/**
 * 词汇详情接口
 *
 * 表示识别文本中的单个词汇，包含时间信息和发音详情。
 * 用于提供最细粒度的识别结果展示。
 */
export interface Word {
  /** 词汇的文本内容 */
  text: string
  /** 词汇开始时间（毫秒） */
  startTime: number
  /** 词汇结束时间（毫秒） */
  endTime: number
  /** 词汇的发音表示 */
  pronounce: string
  /** 词汇前的静音时长（毫秒） */
  blankDuration: number
}

/**
 * 支持的音频容器格式
 * @see https://www.volcengine.com/docs/6561/80816?lang=zh
 */
export type AudioFormat = 'raw' | 'wav' | 'mp3' | 'ogg'

/**
 * 支持的音频编码格式
 * @see https://www.volcengine.com/docs/6561/80816?lang=zh
 */
export type AudioCodec = 'raw' | 'opus'

/**
 * 支持的识别结果类型
 * @see https://www.volcengine.com/docs/6561/80816?lang=zh
 */
export type ResultType = 'full' | 'single'

/**
 * 支持的音频语言代码
 * 常用语言代码列表，实际支持更多语言
 */
export type AudioLanguage
  = | 'zh-CN' // 中文（简体）
    | 'zh-TW' // 中文（繁体）
    | 'en-US' // 英语（美国）
    | 'en-GB' // 英语（英国）
    | 'ja-JP' // 日语
    | 'ko-KR' // 韩语
    | 'fr-FR' // 法语
    | 'de-DE' // 德语
    | 'es-ES' // 西班牙语
    | 'it-IT' // 意大利语
    | 'pt-BR' // 葡萄牙语（巴西）
    | 'ru-RU' // 俄语
    | string // 其他语言代码

/**
 * ASR 客户端配置选项接口
 *
 * 用于配置火山引擎 ASR 客户端的各项参数，包括认证信息、
 * 音频格式、识别参数等。
 */
export interface AsrClientOptions {
  /**
   * 火山引擎应用的唯一标识符
   * @description 用于标识您的火山引擎应用，每个应用都有唯一的 appid
   * @example 'your-appid-12345'
   */
  appid: string

  /**
   * 访问令牌，用于身份认证
   * @description 火山引擎访问令牌，用于 API 调用时的身份验证
   * @example 'your-access-token-abcdef'
   */
  token: string

  /**
   * 集群配置
   * @default 可选参数，如不指定则使用默认集群
   * @description ASR 服务的集群配置，通常不需要手动设置
   * @example 'your-cluster-name'
   */
  cluster?: string

  /**
   * 识别工作流程配置
   * @default 'audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate'
   * @description 控制识别处理流程的组件组合
   *
   * **工作流程组件说明：**
   * - `audio_in` - 音频输入
   * - `resample` - 重采样
   * - `partition` - 分割
   * - `vad` - 语音活动检测
   * - `fe` - 特征提取
   * - `decode` - 解码识别
   * - `itn` - 逆文本规范化（数字转文字）
   * - `nlu_ddc` - 顺滑处理
   * - `nlu_punctuate` - 标点符号
   *
   * **常用配置：**
   * - 基础识别：`'audio_in,resample,partition,vad,fe,decode'`
   * - 识别 + ITN：`'audio_in,resample,partition,vad,fe,decode,itn'`
   * - 识别 + 标点：`'audio_in,resample,partition,vad,fe,decode,nlu_punctuate'`
   * - 全功能（默认）：`'audio_in,resample,partition,vad,fe,decode,itn,nlu_ddc,nlu_punctuate'`
   */
  workflow?: string

  /**
   * 音频容器格式
   * @default 'wav'
   * @description 指定音频文件的容器格式
   *
   * **支持的格式：**
   * - `'wav'` - 无损音频格式，默认格式，推荐使用
   * - `'raw'` - 原始 PCM 音频数据，适用于实时音频流
   * - `'mp3'` - MPEG-1 Audio Layer 3，压缩音频文件
   * - `'ogg'` - Ogg Vorbis 格式，开源音频格式
   *
   * **格式与编码组合建议：**
   * - WAV + PCM（默认，最稳定）：`{ format: 'wav', codec: 'raw' }`
   * - RAW + PCM（实时流）：`{ format: 'raw', codec: 'raw' }`
   * - OGG + Opus（压缩流）：`{ format: 'ogg', codec: 'opus' }`
   */
  format?: AudioFormat

  /**
   * 音频编解码器
   * @default 'raw'
   * @description 音频编码格式
   *
   * **支持的编码：**
   * - `'raw'` - 原始 PCM 编码，默认值，适用于未压缩音频
   * - `'opus'` - Opus 音频编码，适用于压缩音频流
   *
   * **注意事项：**
   * - MP3 格式通常内部已编码，codec 参数可能不适用
   * - 推荐使用 wav 或 raw 格式配合 raw codec
   */
  codec?: AudioCodec

  /**
   * 音频分段大小（字节）
   * @default 160000
   * @description 控制音频数据的分段大小，约 5 秒 16kHz 单声道音频
   *
   * **计算公式：**
   * - 16kHz, 16位, 单声道：每秒 32000 字节
   * - 2秒音频：32000 × 2 = 64000 字节
   * - 5秒音频：32000 × 5 = 160000 字节（默认值）
   *
   * **使用场景：**
   * - 实时流式识别：设置较小值，如 32000（1秒）
   * - 文件识别：可使用默认值或更大值
   */
  segSize?: number

  /**
   * WebSocket 服务地址
   * @default 'wss://openspeech.bytedance.com/api/v2/asr'
   * @description ASR 服务的 WebSocket 访问地址
   *
   * **默认地址说明：**
   * - 生产环境：`wss://openspeech.bytedance.com/api/v2/asr`
   * - 通常不需要手动设置，使用默认值即可
   *
   * **注意事项：**
   * - 修改此地址可能会影响服务稳定性
   * - 仅在特殊部署需求下才需要修改
   */
  url?: string

  /**
   * 音频采样率
   * @default 16000
   * @description 音频采样率（Hz）
   *
   * **常见采样率：**
   * - `8000` - 电话质量，文件小
   * - `16000` - 语音识别推荐，平衡质量和大小（默认值）
   * - `44100` - CD 质量
   * - `48000` - 专业音频
   *
   * **选择建议：**
   * - 语音识别首选 16000 Hz（默认）
   - 音频文件采样率应与配置一致，否则可能导致识别质量下降
   */
  rate?: number

  /**
   * 音频语言
   * @default 'zh-CN'
   * @description 音频语言代码（ISO 639-1 + ISO 3166-1）
   *
   * **常用语言代码：**
   * - `'zh-CN'` - 中文（简体）
   * - `'zh-TW'` - 中文（繁体）
   * - `'en-US'` - 英语（美国）
   * - `'en-GB'` - 英语（英国）
   * - `'ja-JP'` - 日语
   * - `'ko-KR'` - 韩语
   * - `'fr-FR'` - 法语
   * - `'de-DE'` - 德语
   * - `'es-ES'` - 西班牙语
   */
  language?: AudioLanguage

  /**
   * 音频位深度
   * @default 16
   * @description 每个采样点的位数
   *
   * **常见位深度：**
   * - `8` - 8位，质量较低，文件小
   * - `16` - 16位，标准配置（默认值）
   * - `24` - 24位，高质量
   * - `32` - 32位，专业音频
   *
   * **选择建议：**
   * - 语音识别推荐使用 16 位（默认）
   - 确保与音频文件的实际位深度一致
   */
  bits?: number

  /**
   * 音频声道数
   * @default 1
   * @description 音频声道数
   *
   * **声道选择：**
   * - `1` - 单声道（mono），推荐用于语音识别，文件更小，处理更快（默认值）
   * - `2` - 立体声（stereo），如果音频是立体声，需要设置为 2
   *
   * **使用建议：**
   * - 语音识别通常使用单声道即可
   * - 双声道音频会自动混合为单声道进行处理
   */
  channel?: number

  /**
   * 返回识别结果候选数量
   * @default 1
   * @description 指定返回识别结果的候选数量
   *
   * **使用说明：**
   * - `1` - 返回最佳识别结果（默认）
   * - `>1` - 返回多个候选结果，用于歧义消解
   *
   * **注意事项：**
   * - 设置较大值会增加响应时间和数据量
   * - 一般场景下使用默认值即可
   */
  nbest?: number

  /**
   * 是否在结果中显示语言信息
   * @default false
   * @description 是否在识别结果中显示检测到的语言类型
   *
   * **使用场景：**
   * - `true` - 结果中包含 `language` 字段
   * - `false` - 结果中不包含语言信息（默认）
   *
   * **结果示例：**
   * ```json
   * {
   *   "text": "识别文本",
   *   "language": "zh-CN"
   * }
   * ```
   */
  showLanguage?: boolean

  /**
   * 是否在结果中显示详细话语信息
   * @default false
   * @description 是否返回详细的话语信息（分句、分词、时间戳）
   *
   * **使用场景：**
   * - `true` - 结果中包含 `utterances` 数组，每个分句包含详细时间信息
   * - `false` - 结果中不包含详细话语信息（默认）
   *
   * **需要配合使用的参数：**
   * - `resultType: 'full'` - 返回所有已识别的分句
   * - `workflow` 包含相关处理组件
   *
   * **结果示例：**
   * ```json
   * {
   *   "text": "你好世界",
   *   "utterances": [
   *     {
   *       "text": "你好",
   *       "startTime": 0,
   *       "endTime": 500,
   *       "definite": true,
   *       "words": [...]
   *     }
   *   ]
   * }
   * ```
   */
  showUtterances?: boolean

  /**
   * 结果类型
   * @default 'full'
   * @description 控制返回结果的方式
   *
   * **类型说明：**
   * - `'full'` - 返回所有已识别的分句（默认）
   * - `'single'` - 每次只返回当前分句
   *
   * **使用场景：**
   * - `'full'`：适用于离线文件识别，返回完整识别结果
   * - `'single'`：适用于流式识别，需配合 `showUtterances: true` 使用
   *
   * **配合参数：**
   * - `'single'` 模式建议设置 `showUtterances: true`
   */
  resultType?: ResultType

  /**
   * 用户标识符
   * @default 'streaming_asr_demo'
   * @description 用于标识请求的用户或会话
   *
   * **使用场景：**
   * - 区分不同用户的请求
   * - 在日志和监控中追踪用户行为
   * - 多用户环境下的请求管理
   */
  uid?: string

  /**
   * 请求超时时间（毫秒）
   * @default 60000
   * @description WebSocket 请求的超时时间设置
   *
   * **超时设置建议：**
   * - `30000` - 30秒，适用于短音频文件
   * - `60000` - 1分钟，适用于一般场景（默认）
   * - `120000` - 2分钟，适用于长音频文件
   *
   * **注意事项：**
   * - 超时时间过短可能导致长音频识别失败
   * - 超时时间过长可能影响用户体验
   * - 根据实际音频长度调整超时设置
   */
  timeout?: number
}

/**
 * 协议版本枚举
 *
 * 定义火山引擎 ASR 协议支持的版本号。
 */
export enum ProtocolVersion {
  /** 协议版本 1 */
  V1 = 0b0001,
}

/**
 * 消息类型枚举
 *
 * 定义 WebSocket 通信中的消息类型，包括客户端请求和服务器响应。
 */
export enum MessageType {
  /** 客户端完整请求消息 */
  CLIENT_FULL_REQUEST = 0b0001,
  /** 客户端仅音频请求消息 */
  CLIENT_AUDIO_ONLY_REQUEST = 0b0010,
  /** 服务器完整响应消息 */
  SERVER_FULL_RESPONSE = 0b1001,
  /** 服务器确认消息 */
  SERVER_ACK = 0b1011,
  /** 服务器错误响应消息 */
  SERVER_ERROR_RESPONSE = 0b1111,
}

/**
 * 消息类型特定标志枚举
 *
 * 定义消息类型的特定标志，用于指示消息的序列处理方式。
 */
export enum MessageTypeSpecificFlags {
  /** 不进行序列检查 */
  NO_SEQUENCE = 0b0000,
  /** 正序列检查 */
  POS_SEQUENCE = 0b0001,
  /** 负序列检查 */
  NEG_SEQUENCE = 0b0010,
  /** 负序列1检查 */
  NEG_SEQUENCE_1 = 0b0011,
}

/**
 * 序列化类型枚举
 *
 * 定义消息负载数据的序列化方法。
 */
export enum SerializationType {
  /** 无序列化处理 */
  NO_SERIALIZATION = 0b0000,
  /** JSON 序列化 */
  JSON = 0b0001,
  /** Thrift 序列化 */
  THRIFT = 0b0011,
  /** 自定义序列化类型 */
  CUSTOM_TYPE = 0b1111,
}

/**
 * 压缩类型枚举
 *
 * 定义消息负载数据的压缩方法。
 */
export enum CompressionType {
  /** 无压缩处理 */
  NO_COMPRESSION = 0b0000,
  /** GZIP 压缩 */
  GZIP = 0b0001,
  /** 自定义压缩方法 */
  CUSTOM_COMPRESSION = 0b1111,
}

/**
 * ASR 服务成功响应代码
 */
export const ASR_SUCCESS_CODE = 1000

/**
 * 默认的 WebSocket 消息头
 *
 * 基于 Go 实现定义的默认消息头常量，用于不同类型的消息发送。
 */

/** 默认完整客户端请求消息头 */
export const DefaultFullClientWsHeader = new Uint8Array([0x11, 0x10, 0x11, 0x00])

/** 默认仅音频请求消息头 */
export const DefaultAudioOnlyWsHeader = new Uint8Array([0x11, 0x20, 0x11, 0x00])

/** 默认最后音频片段消息头 */
export const DefaultLastAudioWsHeader = new Uint8Array([0x11, 0x22, 0x11, 0x00])

/**
 * WebSocket 消息头结构接口
 *
 * 定义 WebSocket 消息头的各个组成部分，用于构建和解析消息头部信息。
 */
export interface WsHeader {
  /** 协议版本号 */
  protocolVersion: ProtocolVersion
  /** 默认头部大小 */
  defaultHeaderSize: number
  /** 消息类型 */
  messageType: MessageType
  /** 消息类型特定标志 */
  messageTypeSpecificFlags: MessageTypeSpecificFlags
  /** 序列化类型 */
  serializationType: SerializationType
  /** 压缩类型 */
  compressionType: CompressionType
}
