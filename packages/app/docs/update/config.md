# 配置

## env 文件

发布相关参数集中在 `packages/app/env/.env`(从 `.env.example` 复制),只放基础设施命名,不是密钥;GCS 鉴权走 `gcloud auth login`(落在 `~/.config/gcloud`)

```bash
cd packages/app && cp env/.env.example env/.env
```

| 变量 | 必填 | 说明 |
|---|---|---|
| `GCP_PROJECT` | 是 | GCP 项目 ID |
| `UPDATE_BUCKET` | 是 | 存放更新产物的 GCS bucket 名 |
| `UPDATE_PREFIX` | 否,默认 `desktop` | bucket 内对象前缀,区分 stable / beta |
| `GCS_PUBLIC_BASE_URL` | 否 | 公开下载地址,默认由 `bucket/prefix` 推导 |
| `UPDATE_PUBLISH_URL` | 否 | 仅当下载地址 ≠ GCS 公开地址(接了独立 CDN 域名)时才填 |
| `LATEST_DMG_ALIAS` | 否,默认 `app-latest.dmg` | 手动下载稳定入口；上传脚本会把当前构建的 `.dmg` 额外复制到这个固定文件名 |

`.env` 已被根 `.gitignore` 忽略,填真实值不会提交;`.env.example` 作为模板被跟踪

## publish.url 注入(无需手改 yml)

打包时 `electron-builder` 会把 `publish.url` 烧进安装包内部的 `app-update.yml`,**客户端只认这个烧进去的地址**

`build-for.mjs` 启动时 `loadEnv(env/)`,按下面优先级用 `-c.publish.url` 覆盖 yml(CLI 覆盖优先级高于 yml),所以**不用手改 `electron-builder.yml`**:

```text
UPDATE_PUBLISH_URL  >  GCS_PUBLIC_BASE_URL  >  由 UPDATE_BUCKET / UPDATE_PREFIX 推导
```

`upload-gcs-update-feed.ts` 用同一套规则推导上传目标和校验地址,保证「烧进包的地址」和「实际上传的地址」一字不差

三者都没设时,沿用 `electron-builder.yml` 里 `publish.url` 的兜底值

## 两个配置文件

| 场景 | 文件 | 用法 |
|---|---|---|
| 开发联调 | `dev-app-update.yml` | `pnpm dev` 时读取,指向本地更新服务器 |
| 正式发版 | `electron-builder.yml` 的 `publish` | 兜底默认值,通常由 env 覆盖 |

格式一样:

```yaml
provider: generic
url: http://127.0.0.1:8788
```

`generic` 不会自动上传产物,需要自己把构建文件放到这个 URL 对应的目录

### dev-app-update.yml

`packages/app/dev-app-update.yml` 指向本地服务器:

```yaml
provider: generic
url: http://127.0.0.1:8788
updaterCacheDirName: electron-app-updater
```

开发环境 `app.isPackaged` 为 false,updater 默认不工作。`service.ts` 在 `is.dev` 时置 `forceDevUpdateConfig = true`,让它读取这个文件以便本地联调
