# macOS 本机假证书签名

本流程只用于本机开发。它用 `scripts/selfsign-app.ts` 创建本地 code signing 证书，让 macOS TCC 按稳定签名身份记住辅助功能等授权

它不能替代正式签名，不能给用户分发。正式发布见 [mac-official-signing.md](./mac-official-signing.md)

## 为什么需要

未正式签名的 Electron 包通常是 ad-hoc 签名。ad-hoc 的身份依赖构建产物 hash，每次重建都可能变化，TCC 授权容易表现为“系统设置里开了，但打包后仍然没权限”

自签名证书会给 app 一个稳定的 designated requirement：

```text
bundle id + certificate root
```

只要 bundle id 和这张本地证书不变，重建后授权可以沿用

## 一次性初始化

在仓库根目录执行：

```bash
pnpm -F app sign:setup
```

脚本会做这些事：

1. 生成本地 code signing 证书
2. 创建独立钥匙串 `local-codesign.keychain-db`
3. 导入证书和私钥
4. 放行 `/usr/bin/codesign`
5. 把钥匙串加入用户搜索列表

## 日常本机打包

```bash
pnpm -F app build:unpack:prod
```

这个命令会先打出 unpacked `.app`，再调用 `selfsign-app.ts install`：

1. 找到 `dist/dist/mac*/<App>.app`
2. 拷贝到 `~/Applications`
3. 签 `Contents/Resources` 下的 Mach-O helper
4. `codesign --deep` 重签整个 `.app`
5. 校验签名

第一次运行后，到 **系统设置 → 隐私与安全性 → 辅助功能** 给 app 授权。授权后退出并重新打开 app

## 手动重签已有 app

```bash
pnpm -F app sign:install
```

或者指定 `.app` 路径：

```bash
bun packages/app/scripts/selfsign-app.ts install /path/to/App.app
```

## 验证

```bash
codesign --verify --deep --strict ~/Applications/<App>.app
codesign -dvvv ~/Applications/<App>.app 2>&1 | grep -E 'Identifier=|Authority='
```

预期：

```text
Authority=Local CodeSign
```

## 清理

```bash
pnpm -F app sign:cleanup
```

清理会从搜索列表移除本地签名钥匙串并删除钥匙串。已经签好的 `.app` 仍可运行，但之后不能再用这张证书重签

## 常见问题

| 问题 | 处理 |
|---|---|
| `no identity found` | 先跑 `pnpm -F app sign:setup`，确认本地钥匙串在搜索列表里 |
| 授权后仍无效 | 退出 app 后重新打开；TCC 权限变更通常要重启 app 才生效 |
| 换了 bundle id 后授权丢失 | 正常现象，bundle id 变了，TCC 视为另一个 app |
| 拷给别人后打不开 | 正常现象，自签名不能通过 Gatekeeper；发布必须用正式证书和公证 |
