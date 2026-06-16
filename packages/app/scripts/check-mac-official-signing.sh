#!/usr/bin/env bash
set -u

info() {
  printf '\n==> %s\n' "$1"
}

ok() {
  printf '✅ %s\n' "$1"
}

warn() {
  printf '⚠️  %s\n' "$1"
}

fail() {
  printf '❌ %s\n' "$1"
}

run_or_fail() {
  local message="$1"
  shift

  if "$@"; then
    ok "$message"
    return 0
  fi

  fail "$message"
  return 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "当前不是 macOS，无法检查 Developer ID 签名链路"
  exit 1
fi

missing_commands=()
for command in security codesign openssl curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    missing_commands+=("$command")
  fi
done

if (( ${#missing_commands[@]} > 0 )); then
  fail "缺少命令：${missing_commands[*]}"
  exit 1
fi

status=0
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

info "检查 1/2：Developer ID Application 证书和私钥"

identity="${CSC_NAME:-}"

if [[ -n "$identity" && "$identity" != Developer\ ID\ Application:* ]]; then
  identity="Developer ID Application: $identity"
fi

if [[ -z "$identity" ]]; then
  identity="$(
    security find-identity -v -p codesigning \
      | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' \
      | head -n 1
  )"
fi

if [[ -z "$identity" ]]; then
  fail "没有找到 Developer ID Application 签名身份"
  printf '处理：确认 .cer 已导入登录钥匙串，并且证书下面有私钥；或设置 CSC_NAME。\n'
  exit 1
fi

printf '使用签名身份：%s\n' "$identity"

cp /bin/echo "$tmp_dir/cert-check"

if codesign --sign "$identity" --force --options runtime "$tmp_dir/cert-check" >/tmp/check-mac-cert.log 2>&1 \
  && codesign --verify --verbose=2 "$tmp_dir/cert-check" >/tmp/check-mac-cert-verify.log 2>&1; then
  ok "证书和私钥可用，codesign 可以完成本地签名"
else
  fail "证书或私钥不可用，codesign 本地签名失败"
  cat /tmp/check-mac-cert.log /tmp/check-mac-cert-verify.log 2>/dev/null
  printf '\n常见原因：证书没有私钥、CSC_NAME 写错、钥匙串未授权 codesign 访问私钥。\n'
  status=1
fi

info "检查 2/2：当前网络到 Apple timestamp 服务"

printf '当前 DNS：'
networksetup -getdnsservers Wi-Fi 2>/dev/null | tr '\n' ' '
printf '\n'

if command -v dig >/dev/null 2>&1; then
  printf 'timestamp.apple.com A 记录：'
  dig +short timestamp.apple.com A | tr '\n' ' '
  printf '\n'
else
  warn "未找到 dig，跳过 DNS 展示"
fi

printf 'timestamp probe' > "$tmp_dir/data.txt"
openssl ts \
  -query \
  -data "$tmp_dir/data.txt" \
  -sha256 \
  -cert \
  -out "$tmp_dir/request.tsq" >/tmp/check-mac-openssl.log 2>&1

if curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 10 \
  -H 'Content-Type: application/timestamp-query' \
  --data-binary "@$tmp_dir/request.tsq" \
  http://timestamp.apple.com/ts01 \
  -o "$tmp_dir/response.tsr" >/tmp/check-mac-timestamp-curl.log 2>&1; then
  ok "Apple timestamp HTTP 服务可达"
else
  fail "Apple timestamp HTTP 服务不可达"
  cat /tmp/check-mac-timestamp-curl.log 2>/dev/null
  printf '\n处理：优先检查 Wi-Fi DNS。公共 DNS（如 8.8.8.8）可能绕过公司网关 fake-ip DNS，导致 timestamp.apple.com 直连失败。\n'
  status=1
fi

cp /bin/echo "$tmp_dir/timestamp-check"

if codesign --sign "$identity" --force --timestamp --options runtime "$tmp_dir/timestamp-check" >/tmp/check-mac-codesign-timestamp.log 2>&1 \
  && codesign --verify --verbose=2 "$tmp_dir/timestamp-check" >/tmp/check-mac-codesign-timestamp-verify.log 2>&1; then
  ok "codesign --timestamp 端到端通过"
else
  fail "codesign --timestamp 端到端失败"
  cat /tmp/check-mac-codesign-timestamp.log /tmp/check-mac-codesign-timestamp-verify.log 2>/dev/null
  printf '\n说明：证书本地签名通过但 timestamp 失败时，问题通常在网络/DNS/代理，不在证书。\n'
  status=1
fi

if (( status == 0 )); then
  info "结论"
  ok "当前 Apple 证书和网络都可以用于正式 macOS 签名与公证前置流程"
else
  info "结论"
  fail "当前环境还不能稳定完成正式 macOS 签名链路，请按上面的失败项处理"
fi

exit "$status"
