# 档② 自签本机真装(免 Apple)

测**真正的「重启并安装」**——下载完点一下,App 真的被替换成新版本号。这是 [档①](./testing-local.md) 测不到的最后一步

## 原理与边界

macOS 的更新交换(Squirrel.Mac)要的是**签名连续性**,不是必须 Apple 公证:只要**新旧两个版本用同一张证书签**,交换就能成立。本项目的 `selfsign-app.ts` 能生成一张本地自签证书 `Local CodeSign`,正好满足这个条件

关键是要在**构建期**把证书签进 zip(`--selfSign` 干的事),而不是事后补签——事后补签会让 zip 的 `sha512` 对不上

**边界(务必知道)**:

- **仅限本机**。自签过不了 Gatekeeper,换台电脑装不了。要分发给别人,必须走 [档③ 公证](./publishing.md)
- `build:unpack` 那种「打包后再 `selfsign install`」**不能**测自动更新:它是 `--dir` 构建,没有 feed(无 zip / yml),且事后补签碰不到 feed

## 流程

```bash
cd packages/app

# 0) 一次性：生成自签证书、解锁钥匙串、加搜索列表
pnpm -F app sign:setup

# 1) 打旧版 1.0.0 并装到 ~/Applications
#    （dir 构建 + 自签安装；publish.url 从 env 注入，指向你的 GCS）
pnpm -F app build:unpack

# 2) 产出新版 1.0.1：同一证书签 feed + 随机 payload，上传 GCS
#    （自动 bump，跑完还原 package.json）
pnpm -F app update:feed:mac:selfsign:gcs
```

3. 打开 `~/Applications/electron-app.app` → `/update` → 检查更新 → 下载(进度/增量)→ **重启并安装** → 版本变 `1.0.1` ✅

新旧两份都是 `Local CodeSign` + 同一 bundle id,DR(identifier + 证书)一致 → Squirrel 签名连续性校验通过,本机交换成立

> 想在本地服务器(不传 GCS)测同一档,用 `update:feed:mac:selfsign`(自签 + 本地静态服务器)
>
> 证书名可用 `SIGN_CERT_NAME` 覆盖,需与 `build-for.mjs` 的 `--selfSign` 一致

## 三个验证点

1. **确认旧版去对地址查更新**(打包后):

   ```bash
   cat ~/Applications/electron-app.app/Contents/Resources/app-update.yml   # url 应是你的 GCS 地址
   ```

   不对就是 env 没设好 → 重打 `build:unpack`

2. **钥匙串锁了会签失败**。重启后 `local-codesign` 钥匙串会锁;Step 2 报 `no identity found` / `User interaction is not allowed` 时,重跑 `pnpm -F app sign:setup` 解锁

3. **runtime flag 差异**(唯一潜在变数,需真机确认):旧版(`build:unpack`,不带 hardened runtime)与新版(`electron-builder.yml` 里 `hardenedRuntime: true`)的 flag 不一致。理论上 DR 只看 identifier + 证书、不看这个 flag,交换应当成立;万一交换失败,把旧版也改用 `update:feed:mac:selfsign` 的产物安装(两边完全同构)即可兜底
