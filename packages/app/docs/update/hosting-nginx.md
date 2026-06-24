# 托管:Nginx 自建

适合自建机器或内网测试。只要能按 URL 访问静态文件、且支持 HTTP Range 即可

## 最小配置

```nginx
server {
  listen 80;
  server_name updates.example.com;
  root /var/www/electron-updates;

  # latest*.yml 是版本入口，不能长缓存
  location ~* latest.*\.yml$ {
    add_header Cache-Control "no-store";
    try_files $uri =404;
  }

  location / {
    try_files $uri =404;
  }
}
```

把构建产物(`latest*.yml` + 安装包 + `.blockmap`)放到 `root` 目录,再把 `publish.url` 指向它(或用 env 注入,见 [config.md](./config.md)):

```yaml
publish:
  provider: generic
  url: https://updates.example.com
```

## 验证

```bash
curl -I "https://updates.example.com/latest-mac.yml"                  # 200，Cache-Control: no-store
curl -I -H 'Range: bytes=0-1' "https://updates.example.com/your-installer-file"  # 206 Partial Content
```

Nginx 默认对静态文件支持 Range,通常无需额外配置。其它静态服务器(MinIO、Caddy 等)同理,只要满足公开可读 + Range 即可
