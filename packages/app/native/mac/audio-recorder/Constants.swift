import AVFoundation
import Cocoa
import CoreAudio
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

/// native helper 构建标识,启动时打进二进制并输出横幅;发包时用 `strings ... | rg` 核验装进去的是最新 helper 而非旧缓存
let AUDIO_RECORDER_BUILD_ID = "2026-07-30-mic-device-change-recovery"

/// 是否强制麦克风走合成时间轴(时长由帧数推,不信任源 hostTime/PTS);sidecar 主路径已天然免疫,此开关保留给旧 realtime AAC 路径兜底
let FORCE_SYNTHETIC_MIC_TIMELINE = true

/// raw AVAudioEngine 启动瞬时失败(如 `!dev` 设备忙:上一条录音/VPIO 拆除未完成即抢设备)的最大重试次数
let RAW_AUDIO_ENGINE_START_ATTEMPTS = 3

/// 每次重试前的等待(秒),给 HAL / VPIO 拆除后释放输入设备留窗口;过短会连撞 `!dev`,过长会拖慢开录
let RAW_AUDIO_ENGINE_RETRY_DELAY_SEC: TimeInterval = 0.35

/// 引擎 `start()` 成功后等待首个麦克风回调的最长时间(秒);超时即判「僵尸引擎」(启动成功却零数据流),拆掉后重试 / 降级
let MIC_FIRST_SAMPLE_PROBE_TIMEOUT_SEC: TimeInterval = 0.30
/** stop 等待采样队列完成所有已入队写操作的上限；超时转崩溃恢复，绝不继续碰 writer */
let SAMPLE_QUEUE_DRAIN_TIMEOUT_SEC: TimeInterval = 2

/// 首帧探测的轮询间隔(秒):每隔这么久检查一次麦克风回调计数是否推进
let MIC_FIRST_SAMPLE_PROBE_INTERVAL_SEC: TimeInterval = 0.03

/// 开录后多久(秒)仍无任何音频样本(mic 或系统)即报致命错误并终止,防止无声录音;首帧看门狗
let FIRST_AUDIO_SAMPLE_TIMEOUT: TimeInterval = 5

/// 录音中途音频样本中断超过这么久(秒)判为断流
let AUDIO_SAMPLE_GAP_TIMEOUT: TimeInterval = 30

/// 断流看门狗的检查周期(秒)
let AUDIO_SAMPLE_GAP_WATCHDOG_INTERVAL: TimeInterval = 5

/// mic 单轨持续静默多久(秒)判为麦克风掉线(如蓝牙耳机中途断开令 VPIO 引擎僵尸化),触发重挂自愈;
/// 短于整体断流阈值,因系统音轨仍在出样时整体不会超时,mic 死亡只能靠独立时间戳发现
let MIC_SAMPLE_GAP_TIMEOUT: TimeInterval = 8

/// mic 掉线自愈连续失败上限:达上限即停止看门狗周期重试(改由系统默认输入设备变更监听在设备复联时拉起),
/// 并发一次非致命降级诊断。防止设备真不可用时每 tick 空转重挂,也避免「录音成功但后半段无人声」的静默数据损失
let MIC_RECOVERY_MAX_ATTEMPTS = 3

/// mic 恢复的 trailing debounce 静默窗口
/// 这是规避 HAL 连续设备事件的经验窗口，不代表系统承诺此时已完成重配置
let MIC_DEVICE_CHANGE_SETTLE_DELAY_SEC: TimeInterval = 0.5

/// checkpoint 分段落盘周期(秒),供崩溃 / 断电恢复
let AUDIO_CHECKPOINT_INTERVAL: TimeInterval = 5
