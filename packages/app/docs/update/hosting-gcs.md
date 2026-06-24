# 托管:GCS + Cloud CDN(推荐)

有内置上传脚本 `update:upload:gcs`。GCS bucket 可直接作为静态更新源;正式大量分发时建议前面接 Cloud CDN(支持更大缓存对象、可刷新、可绑自定义 HTTPS 域名)

## 安装 gcloud

`gcloud` 来自 **Google Cloud CLI**(不是 npm 包):

| 环境 | 推荐方式 |
|---|---|
| 临时操作 | Console 右上角 Cloud Shell,通常已内置并带登录态 |
| macOS | `brew install --cask gcloud-cli` |
| Linux / macOS 通用 | `curl https://sdk.cloud.google.com \| bash`,完成后重开 shell |
| Debian / Ubuntu | Google 官方 apt 仓库装 `google-cloud-cli` |

登录并选项目:

```bash
gcloud auth login
gcloud config set project "$GCP_PROJECT"
```

## 环境变量

复用 [config.md](./config.md) 的 `env/.env`,脚本读取:

```bash
GCP_PROJECT=<your-gcp-project-id>
UPDATE_BUCKET=<your-update-bucket>
UPDATE_PREFIX=<desktop-release-prefix>
# GCS_PUBLIC_BASE_URL 默认推导为 https://storage.googleapis.com/<bucket>/<prefix>
```

`publish.url` 由 env 注入,无需手改 `electron-builder.yml`(见 [config.md](./config.md))

## bucket 公开读

```bash
gcloud storage buckets describe "gs://$UPDATE_BUCKET"      # public_access_prevention 不能是 enforced
gcloud storage buckets get-iam-policy "gs://$UPDATE_BUCKET"  # 应有 allUsers / roles/storage.objectViewer
```

未公开则让管理员加:

```bash
gcloud storage buckets add-iam-policy-binding "gs://$UPDATE_BUCKET" \
  --member=allUsers --role=roles/storage.objectViewer
```

## 用脚本上传

```bash
pnpm -F app update:upload:gcs
```

脚本会:先传安装包和 `.blockmap`(长缓存)→ 再传 `latest*.yml`(`no-store`)→ 用公开 URL 校验 `latest*.yml` 返回 `200`、安装包 Range 返回 `206`

常用参数:

```bash
pnpm -F app update:upload:gcs -- --dryRun       # 只打印 gcloud 命令不真传（首次强烈建议）
pnpm -F app update:upload:gcs -- --skipVerify   # 跳过上传后校验
pnpm -F app update:upload:gcs -- --envPath=.env.production
pnpm -F app update:upload:gcs -- --project=<p> --bucket=<b> --prefix=<pre>  # CLI 覆盖 env
pnpm -F app update:upload:gcs -- --dir=<path>   # 指定产物目录（默认 dist/dist）
```

预期输出尾部:

```text
Verifying public URLs...
status=200
status=206
content-range=bytes 0-1/<size>
GCS update feed upload completed.
```

## 手动等价命令

先传安装包和 `.blockmap`(带版本号,可长缓存):

```bash
find packages/app/dist/dist -maxdepth 1 -type f \( \
  -name '*.zip' -o -name '*.dmg' -o -name '*.exe' -o -name '*.AppImage' -o -name '*.blockmap' \
\) -exec gcloud storage cp {} "gs://$UPDATE_BUCKET/$UPDATE_PREFIX/" \
  --cache-control="public, max-age=31536000, immutable" \;
```

最后传 `latest*.yml`(版本入口,不缓存):

```bash
find packages/app/dist/dist -maxdepth 1 -type f -name 'latest*.yml' \
  -exec gcloud storage cp {} "gs://$UPDATE_BUCKET/$UPDATE_PREFIX/" \
    --content-type="text/yaml; charset=utf-8" --cache-control="no-store" \;
```

验证:

```bash
curl -I "$GCS_PUBLIC_BASE_URL/latest-mac.yml"                              # 200，Cache-Control: no-store
curl -I -H 'Range: bytes=0-1' "$GCS_PUBLIC_BASE_URL/app-1.0.1-arm64-mac.zip"  # 206 + Content-Range
```

接了 Cloud CDN 时,更新 `latest*.yml` 后要刷新 CDN 里这些入口文件。不要把 service account key、signed URL 写进 App;App 只需公开可读的 HTTPS 地址

## 目录结构示例

```text
gs://$UPDATE_BUCKET/$UPDATE_PREFIX/
├── latest.yml  latest-mac.yml  latest-linux.yml
├── app-1.0.1-setup.exe(.blockmap)
├── app-1.0.1-arm64-mac.zip(.blockmap)
├── app-1.0.1.dmg
└── app-1.0.1.AppImage(.blockmap)
```
