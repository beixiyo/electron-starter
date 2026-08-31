# 原生依赖与分发

## 为什么不把 XCFramework 作为普通 Git blob

RecorderAPM 的 universal 静态 XCFramework 约 7 MB。把它作为普通 Git blob 会增加 clone/fetch 体积；每次重建产生的新 blob 也无法有效 diff。Git LFS 能改善仓库对象管理，但 clone/checkout 仍可能下载大文件，并要求所有开发者和 CI 正确安装 LFS

这 7 MB 首先是构建产物和仓库下载体积，不等同于运行时常驻内存。静态链接后，helper 可执行文件只包含链接器实际保留的代码；`processor: 'off'` 不会实例化 APM 或分配其工作状态，但可执行文件仍包含已链接的 AEC3 代码

## 上游源码与内部边界

- 算法上游是 [Google WebRTC Audio Processing Module](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/)
- 本项目实际构建 [Freedesktop `webrtc-audio-processing`](https://gitlab.freedesktop.org/pulseaudio/webrtc-audio-processing) 2.1，它是 Google WebRTC 音频处理模块的可独立构建版本，对应 WebRTC M131 基线
- 精确构建输入是 GStreamer Freedesktop 镜像中的 [`webrtc-audio-processing-2.1.tar.xz`](https://gstreamer.freedesktop.org/src/mirror/webrtc-audio-processing/webrtc-audio-processing-2.1.tar.xz)，SHA256 固定在 `build-webrtc-apm.sh`，不能跟随上游分支浮动
- `APMShim/RecorderAPM.cpp` 与 `RecorderAPM.h` 属于本项目，只提供窄 C ABI；`RecorderAPM.xcframework` 是该 shim、上游 C++ 静态库和两个 macOS 架构的构建产物
- Freedesktop 项目的官方源码托管在 GitLab，不使用非官方 GitHub 镜像作为构建来源

## 当前策略

- Git 只保存中性 C/C++ shim 源码、头文件、构建脚本、固定版本/哈希和许可证文本；每次生成物的 provenance 与 XCFramework 一起留在本地缓存
- 生成的 `RecorderAPM.xcframework`、静态库和 `resources/native/mac` 下的生成资源写入 gitignore
- `build-mac.sh` 在缺少生成 XCFramework 时先下载固定 GitHub Release asset，并校验代码内固定的 ZIP SHA256、provenance、shim/header/archive SHA 与 universal 架构
- Release 不可用时回退到固定源码构建；下载成功但 SHA 或 provenance 不匹配时硬失败，不能用源码构建掩盖供应链异常
- Release URL 固定为 `recorder-apm-v1/RecorderAPM-2.1-shim-v1-macos-universal.xcframework.zip`，不读取 `latest`，也不在原 tag 下覆盖资产
- 许可证源目录缺失或生成资源无法安装时硬失败，不能静默生成一个缺声明的 app
- SwiftPM 只有在 bootstrap 生成 binary target 后才构建 helper；运行时 `off` 只保证不创建 APM 处理实例，不承诺从可执行文件移除静态链接代码

## 发布 RecorderAPM asset

1. 从与目标 tag 对应的源码执行 `build-webrtc-apm.sh`
2. 将完整 `RecorderAPM.xcframework` 打包为脚本声明的 asset 名称
3. 将 ZIP SHA256 更新到 `build-mac.sh`，复核内部 `BUILD-PROVENANCE.txt`
4. 先创建 draft release、上传 ZIP 与 `.sha256`，确认资产完整后再发布
5. 仓库启用 GitHub immutable releases；需要更新时发布 `recorder-apm-v2`，不修改 v1

Release asset 只是开发者和 CI 的快速 bootstrap。源码构建始终保留，作为审计和平台重建路径。两条路径最终都必须经过同一个 `has_valid_apm_artifact` 校验

## 许可证

WebRTC APM、Abseil、RNNoise、FFT/PFFFT 等静态链接组件的许可证和 PATENTS 声明随 app 资源打包。文本不需要签名为 Mach-O，但必须被 electron-builder 的 `extraResources` 明确纳入。发布前检查 app bundle 中声明文件数量、非空状态和与构建 provenance 的对应关系

## 不要做的事

- 不要把临时 `.a`、`.xcframework`、模型或下载缓存提交到 Git
- 不要为了兼容旧包保留多个同名 ABI、旧 schema 或隐式版本探测
- 不要只记录“构建成功”；必须记录 archive/header/shim 的 SHA256 和 universal 架构
