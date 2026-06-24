# 常见问题

| 现象 | 先查 |
|---|---|
| 检查不到更新 | `latest*.yml` 是否可访问;`version` 是否高于当前;包里 `app-update.yml` 的 `url` 是否指对(见下) |
| 下载失败 | 元数据里的文件名是否真的存在于服务器 |
| 每次全量下载 | 是否上传了 `.blockmap`;服务器是否支持 Range(`206`) |
| macOS 不安装 | 是否签名 / 公证,并上传了 `zip`([档②](./testing-selfsign.md) / [档③](./publishing.md)) |
| 自签交换失败 | 新旧版是否同一证书 + 同 bundle id;钥匙串是否解锁([testing-selfsign.md](./testing-selfsign.md)) |
| 开发态点「重启安装」没反应 | 开发壳不能测安装,bundle id 是 `com.github.Electron`,用打包产物测 |

## 确认包里查的是哪个地址

客户端只认烧进安装包的 `app-update.yml`:

```bash
# macOS 打包产物
cat <YourApp>.app/Contents/Resources/app-update.yml
```

`url` 不对 → env 没设好或没经 `build-for.mjs` 注入,重新打包(见 [config.md](./config.md))

## 确认服务器入口正常

```bash
curl -I "<publish.url>/latest-mac.yml"                       # 200，Cache-Control 不应长缓存
curl -I -H 'Range: bytes=0-1' "<publish.url>/<installer>"    # 206 + Content-Range
```

接了 CDN 时,发新版后记得刷新 `latest*.yml` 缓存
