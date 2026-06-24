# 档③ 正式发布

签名 + 公证的正式包,可分发到**任意电脑**。这是唯一适合真实用户的档

## 签名公证要求

- **macOS** 自动更新需要 Developer ID 签名 + 公证;`latest-mac.yml` 实际优先用 `zip` 包(`dmg` 给用户手动下载)
- **Windows** 自动更新需要代码签名;若设了 `publisherName`,要和证书 CN 匹配
- **Linux** 只有 AppImage 适合走差分自动更新;snap 由 snap store 刷新,deb 通常是包管理器场景

打 macOS 正式包需要 Apple 公证凭据(下面其一):

```text
APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
```

## 版本和文件名

版本只认 `package.json` 的 `version`,发新版必须递增。客户端下载哪个包**不是扫描 CDN 目录决定的**,而是由 `latest*.yml` 里的 `files[].url` / `path` 决定:

```yaml
version: 1.0.1
files:
  - url: app-1.0.1-mac.zip
    sha512: ...
path: app-1.0.1-mac.zip
sha512: ...
```

当前命名规则(`electron-builder.yml`):

| 平台 | 规则 | 示例 |
|---|---|---|
| Windows | `${name}-${version}-setup.exe` | `app-1.0.1-setup.exe` |
| macOS dmg | `${name}-${version}.dmg` | `app-1.0.1.dmg` |
| Linux AppImage | `${name}-${version}.AppImage` | `app-1.0.1.AppImage` |

不要手写这些 yml,让 `electron-builder` 生成后原样上传

## 需要上传哪些文件

放在同一个目录(即 `publish.url` 指向的目录):

| 平台 | 必要文件 |
|---|---|
| macOS | `latest-mac.yml`、`*.dmg`、`*.zip`、`*.zip.blockmap` |
| Windows | `latest.yml`、`*-setup.exe`、`*.exe.blockmap` |
| Linux AppImage | `latest-linux.yml`、`*.AppImage`、`*.AppImage.blockmap` |

## 发版流程

1. 递增 `package.json` 的 `version`
2. 按目标平台构建正式包(三个平台可分别在对应 CI runner 上构建,产物汇总到同一前缀):

   ```bash
   pnpm -F app build:mac:prod
   pnpm -F app build:win:prod
   pnpm -F app build:linux:prod
   ```

3. 上传产物(见下方托管接入)。**先传安装包和 `.blockmap`(可长缓存),最后传 `latest*.yml`(不能长缓存)**

## 托管接入

| 方案 | 文档 | 备注 |
|---|---|---|
| **GCS + Cloud CDN** | [hosting-gcs.md](./hosting-gcs.md) | 有内置上传脚本 `update:upload:gcs`,推荐 |
| **S3 + CloudFront** | [hosting-s3.md](./hosting-s3.md) | AWS 经典组合 |
| **Nginx 自建** | [hosting-nginx.md](./hosting-nginx.md) | 自建机器 / 内网 |

## 通用要求

- `latest*.yml` **不要长缓存**,否则用户看不到新版本;CDN 上线后要刷新这些元数据文件
- 安装包必须支持 **HTTP Range**(响应 `Accept-Ranges: bytes`),否则 blockmap 增量下载回退为全量
- 安装包、`.blockmap` 文件名带版本号,**可以长缓存**
- 更新目录建议**公开可读**;私有签名 URL 会增加复杂度,当前模板没做鉴权头
- 同一前缀里不要手写或混放不同构建产物;`latest*.yml`、安装包、`.blockmap` 必须来自同一次构建
- 稳定版与 beta 用独立前缀(如 `/electron-app/` 与 `/electron-app-beta/`)

检查任意安装包的 Range:

```bash
curl -I -H 'Range: bytes=0-1' https://your-cdn/your-installer-file
```

返回 `206 Partial Content` 表示正常
