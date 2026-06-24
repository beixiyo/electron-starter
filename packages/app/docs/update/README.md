# 应用自动更新

基于 `electron-updater`。更新服务器不是业务后端,只是一个**静态文件目录**,App 主动请求元数据文件:

```text
latest.yml        # Windows
latest-mac.yml    # macOS
latest-linux.yml  # Linux
```

元数据里的 `version` 高于当前 `app.getVersion()` 时,`electron-updater` 会下载对应安装包和 `.blockmap`(增量下载所需)

## 文档导航

| 文件 | 内容 |
|---|---|
| [config.md](./config.md) | env 配置、`publish.url` 注入机制、两个配置文件 |
| [testing-local.md](./testing-local.md) | **档①** ad-hoc 本地/GCS 联调:测检查 / 下载 / 进度 / 增量(免证书) |
| [testing-selfsign.md](./testing-selfsign.md) | **档②** 自签本机真装:测「重启并安装」(免 Apple,仅本机) |
| [publishing.md](./publishing.md) | **档③** 正式发布:版本号、上传文件、S3 / GCS / Nginx、签名公证 |
| [faq.md](./faq.md) | 常见问题速查 |

## 三档测试速查

自动更新链路 = 检查 → 下载(进度/增量)→ 重启并安装。**只有最后「替换 App」需要签名**,前面都不需要。按你手上的签名能力选档:

| 档 | 能测到 | 需要 | 主命令 |
|---|---|---|---|
| ① ad-hoc | 检查 / 下载 / 进度 / 增量 | 无 | `update:feed:mac`(本地)`update:feed:mac:gcs`(GCS) |
| ② 自签 | + **本机重启并安装** | `sign:setup` 自签证书 | `update:feed:mac:selfsign:gcs` |
| ③ 公证 | + **可分发到他人电脑** | Apple Developer ID + 公证 | `build:mac:prod` + `update:upload:gcs` |

> Windows / Linux 的机制相同,但本地联调需在对应平台构建对应产物。内置的一键 feed 脚本目前只覆盖 macOS

## 相关代码

| 文件 | 作用 |
|---|---|
| `ipc/services/update/service.ts` | 主进程初始化 updater,转发状态和进度 |
| `ipc/services/update/contract.ts` | IPC 契约与状态机 |
| `renderer/hooks/useUpdater.ts` | 渲染端 Hook |
| `renderer/components/updater/UpdaterPanel.tsx` | 更新面板 |
| `renderer/views/update/page.tsx` | `/update` 演示页 |
| `scripts/build-for.mjs` | 打包,注入 `publish.url`,选择签名档位 |
| `scripts/create-local-update-feed.ts` | 一键产出更新 feed(bump + 随机 payload + 构建 + 服务/上传) |
| `scripts/upload-gcs-update-feed.ts` | 上传产物到 GCS |
| `scripts/selfsign-app.ts` | 本地自签证书,给 `.app` 稳定签名身份 |
