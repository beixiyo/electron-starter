# 档① ad-hoc 联调(检查 / 下载 / 进度 / 增量)

这一档**不需要任何证书**。能完整测自动更新 90% 的功能:发现新版本、下载、进度条、blockmap 增量。唯一测不了的是最后「重启并替换 App」(那一步需要签名,见 [testing-selfsign.md](./testing-selfsign.md) 或 [publishing.md](./publishing.md))

ad-hoc 包是 `identity=null` 构建,不签名、不公证

## 本地最快循环

1. 先用旧版本启动开发应用,保持进程不要重启:

   ```bash
   pnpm -F app dev
   ```

   例如当前 `package.json` 是 `1.0.0`

2. 另开终端,一键生成并启动本地更新源:

   ```bash
   pnpm -F app update:feed:mac
   ```

   这条命令自动闭环:

   - 读取当前 `package.json` 和已有 `latest-mac.yml` 版本
   - 临时把 `package.json` bump 到下一个 patch(`1.0.0 -> 1.0.1`),构建完还原
   - 用该版本构建真实 macOS feed,写入 4MB 随机测试 payload
   - 启动 `http://127.0.0.1:8788`,默认限速 `20 MB/s`,避免本地下载太快看不到进度
   - 默认清理 `~/Library/Caches/electron-app-updater`,避免命中旧缓存(加 `--keepCache` 保留)

3. 回到已打开的旧版应用,打开 `/update`,点「检查更新」。旧进程仍认为自己是 `1.0.0`,服务器 feed 是更高版本,于是能看到更新和下载进度

> `pnpm dev` 启动的是 Electron 开发壳,bundle id 是 `com.github.Electron`,不是打包产物的 `appId`。开发态**不要**点「重启并安装」验证替换 App
>
> 随机 payload 只写进本地联调包,作用是让相邻版本即使代码没变也产生真实差异,避免差分下载太小、速度一直显示 0

## 跑在 GCS 上(验证真实 CDN 行为)

把上面的「本地服务器」换成真实 GCS(需先填好 [env](./config.md)):

```bash
pnpm -F app update:feed:mac:gcs
```

等价于 `update:feed:mac` 的 bump + 随机 payload + 构建,但构建完**上传到 GCS** 而不是起本地服务器。脚本会校验 `latest-mac.yml` 返回 `200`、zip 的 Range 请求返回 `206`

旧版 App 这时去 GCS 检查更新即可(旧版的 `publish.url` 必须已指向 GCS,见 [config.md](./config.md))

## 单独构建 / 单独服务

只构建本地 feed,不起服务器:

```bash
pnpm -F app update:build:mac:next
```

只启动已有 feed 目录:

```bash
pnpm -F app update:serve:slow
```

已自己改好 `package.json` 版本,按当前版本构建并启动:

```bash
pnpm -F app update:feed:mac:current
```

构建产物目录 `packages/app/dist/dist/`,macOS 联调时至少应有:

```text
latest-mac.yml
*.zip
*.zip.blockmap
```

没有这些文件,静态服务器会返回 404。`build:unpack` 只生成解包后的 `.app` 目录,**不会**生成自动更新 feed

也可以不用内置脚本,手动起普通静态服务器:

```bash
cd packages/app/dist/dist
bunx http-server . -p 8788 --cors
```

## 常用参数

```bash
pnpm -F app update:feed:mac -- --version=1.0.5      # 指定测试版本
pnpm -F app update:feed:mac -- --payloadKb=8192     # 调整测试差异大小
pnpm -F app update:feed:mac -- --rateKbps=512       # 故意放慢下载
pnpm -F app update:feed:mac -- --rateKbps=0         # 完全不限速
pnpm -F app update:feed:mac -- --keepCache          # 保留 updater 缓存
```

## 关于增量

进度条来自 `electron-updater` 的 `download-progress` 事件。第一次从空缓存升级时会接近全量下载;连续做 `1.0.1 -> 1.0.2` 这类更新、且服务器支持 Range,才更容易看到 blockmap 差分下载效果

> 不要手动改 `latest-mac.yml`。它是构建产物,`version` / `path` / `sha512` / `.blockmap` 必须来自同一次构建。只改 `version` 会让客户端看到"有更新"但下载对象仍是旧包,进度和增量行为都会失真
