# 托管:S3 + CloudFront

建议用 **CloudFront OAC + 私有 S3 bucket**,用户只访问 CloudFront 域名。不要把 AWS AK/SK、presigned URL 或内部 bucket 地址写进 App;当前模板按公开可读的 CDN URL 设计,没做鉴权 header

## 安装 AWS CLI v2

`aws` 来自 **AWS CLI v2**(不是 npm 包):

| 环境 | 推荐方式 |
|---|---|
| 临时操作 | AWS Console 的 CloudShell,通常已内置并带登录态 |
| macOS | AWS 官方 `.pkg` 安装器 |
| Linux | AWS 官方 zip 安装器(需 `unzip`) |
| Windows | AWS 官方 MSI 安装器 |

macOS:

```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
aws --version
```

Linux x86_64(arm64 把 URL 换成 `awscli-exe-linux-aarch64.zip`):

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install && aws --version
```

配置凭据(SSO 优先,否则普通 IAM key):

```bash
aws configure sso && aws sso login   # 或 aws configure
```

凭据落在 `~/.aws/`;CI 里用 secret 或角色注入,别写进项目

## 发布流程

```bash
export UPDATE_BUCKET="your-update-bucket"
export UPDATE_PREFIX="electron-app"
export CLOUDFRONT_DISTRIBUTION_ID="E1234567890"
```

`publish.url` 指向 CloudFront 上这一层目录(或用 env 注入,见 [config.md](./config.md)):

```yaml
publish:
  provider: generic
  url: https://updates.example.com/electron-app
```

1. 先传安装包和 `.blockmap`(长缓存):

   ```bash
   aws s3 sync packages/app/dist/dist "s3://$UPDATE_BUCKET/$UPDATE_PREFIX/" \
     --exclude "*" \
     --include "*.zip" --include "*.zip.blockmap" \
     --include "*.dmg" --include "*.dmg.blockmap" \
     --include "*.exe" --include "*.exe.blockmap" \
     --include "*.AppImage" --include "*.AppImage.blockmap" \
     --cache-control "public, max-age=31536000, immutable"
   ```

2. 最后传 `latest*.yml`(版本入口,不缓存):

   ```bash
   aws s3 sync packages/app/dist/dist "s3://$UPDATE_BUCKET/$UPDATE_PREFIX/" \
     --exclude "*" --include "latest*.yml" \
     --content-type "text/yaml; charset=utf-8" --cache-control "no-store"
   ```

3. 刷新 CloudFront 入口文件缓存:

   ```bash
   aws cloudfront create-invalidation \
     --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
     --paths "/$UPDATE_PREFIX/latest.yml" "/$UPDATE_PREFIX/latest-mac.yml" "/$UPDATE_PREFIX/latest-linux.yml"
   ```

4. 从 CDN 侧验证:

   ```bash
   curl -I "https://updates.example.com/electron-app/latest-mac.yml"   # 200
   curl -I -H 'Range: bytes=0-1' "https://updates.example.com/electron-app/electron-app-1.0.1-arm64-mac.zip"  # 206
   ```

   S3 支持 Range;若 CloudFront 前还有公司网关 / WAF,要确认它们没吞掉 Range
