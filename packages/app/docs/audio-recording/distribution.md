# 原生依赖与分发

## 为什么不把 XCFramework 作为普通 Git blob

RecorderAPM 的 universal 静态 XCFramework 约 7 MB。把它作为普通 Git blob 会增加 clone/fetch 体积；每次重建产生的新 blob 也无法有效 diff。Git LFS 能改善仓库对象管理，但 clone/checkout 仍可能下载大文件，并要求所有开发者和 CI 正确安装 LFS

这 7 MB 首先是构建产物和仓库下载体积，不等同于运行时常驻内存。静态链接后，helper 可执行文件只包含链接器实际保留的代码；`processor: 'off'` 不会实例化 APM 或分配其工作状态，但可执行文件仍包含已链接的 AEC3 代码

## 当前策略

- Git 只保存中性 C/C++ shim 源码、头文件、构建脚本、固定版本/哈希和许可证文本；每次生成物的 provenance 与 XCFramework 一起留在本地缓存
- 生成的 `RecorderAPM.xcframework`、静态库和 `resources/native/mac` 下的生成资源写入 gitignore
- `build-mac.sh` 在缺少生成 XCFramework 时从固定来源构建，并对 tarball、Abseil wrap、工具版本和架构做校验
- 许可证源目录缺失或生成资源无法安装时硬失败，不能静默生成一个缺声明的 app
- SwiftPM 只有在 bootstrap 生成 binary target 后才构建 helper；运行时 `off` 只保证不创建 APM 处理实例，不承诺从可执行文件移除静态链接代码

## 推荐的后续优化

当 CI/发布系统可提供稳定对象存储后，发布一个不可变、按版本命名的 `RecorderAPM.xcframework.zip`，并在脚本中先下载到本地缓存、验证 SHA256，再交给 SwiftPM。下载失败或校验失败必须硬失败，不能回退到未知二进制

Release Asset 适合开发者和 CI 的快速 bootstrap；源码构建仍应保留，作为审计和平台重建路径。若未来使用 SwiftPM binary target，应同时记录 checksum、来源版本、架构、minOS 和 shim 源码指纹

## 许可证

WebRTC APM、Abseil、RNNoise、FFT/PFFFT 等静态链接组件的许可证和 PATENTS 声明随 app 资源打包。文本不需要签名为 Mach-O，但必须被 electron-builder 的 `extraResources` 明确纳入。发布前检查 app bundle 中声明文件数量、非空状态和与构建 provenance 的对应关系

## 不要做的事

- 不要把临时 `.a`、`.xcframework`、模型或下载缓存提交到 Git
- 不要为了兼容旧包保留多个同名 ABI、旧 schema 或隐式版本探测
- 不要只记录“构建成功”；必须记录 archive/header/shim 的 SHA256 和 universal 架构
