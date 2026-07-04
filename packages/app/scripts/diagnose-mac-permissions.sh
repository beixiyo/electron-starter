#!/usr/bin/env bash
set -u

APP_DISPLAY_NAME="${APP_DISPLAY_NAME:-electron-app}"
DEFAULT_APP_NAME="${DEFAULT_APP_NAME:-$APP_DISPLAY_NAME.app}"
PACKAGE_FILTER="${PACKAGE_FILTER:-app}"
PROJECT_DIST_DIR="${PROJECT_DIST_DIR:-$(pwd)/dist}"
ARTIFACT_DIST_DIR="${ARTIFACT_DIST_DIR:-$PROJECT_DIST_DIR/dist}"
SYSTEM_APP_PATH="${SYSTEM_APP_PATH:-/Applications/$DEFAULT_APP_NAME}"
USER_APP_PATH="${USER_APP_PATH:-$HOME/Applications/$DEFAULT_APP_NAME}"
FULL_DISK_ACCESS_URL='x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'

if [[ (-t 1 || -n "${FORCE_COLOR:-}") && -z "${NO_COLOR:-}" ]]; then
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  BLUE=$'\033[34m'
  MAGENTA=$'\033[35m'
  CYAN=$'\033[36m'
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RESET=$'\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  MAGENTA=''
  CYAN=''
  BOLD=''
  DIM=''
  RESET=''
fi

APP_PATH=''
APP_BUNDLE_ID=''
APP_TEAM_ID=''
APP_AUTHORITY=''
APP_DR=''
ARTIFACT_PATH=''
ARTIFACT_STATUS='未检查'
ARTIFACT_APP_STATUS='未检查'
CODESIGN_STATUS='未检查'
GATEKEEPER_STATUS='未检查'
NOTARIZATION_STATUS='未检查'
QUARANTINE_STATUS='未检查'
TCC_STATUS='未检查'
TCC_SERVICES=''
DR_COMPAT_STATUS='未检查'

usage() {
  cat <<'EOF'
用法:
  bash scripts/diagnose-mac-permissions.sh
  bash scripts/diagnose-mac-permissions.sh [app 路径 | dmg 路径]
  bash scripts/diagnose-mac-permissions.sh [旧 app 路径] [新 app 路径]
  bash scripts/diagnose-mac-permissions.sh --open-full-disk-access

作用:
  1. 没有安装 app 时，自动检测 dist/dist 下最新 .dmg
  2. 已安装 app 时，自动检测默认安装位置
  3. 打印 .app 的 bundle id、签名身份、Team ID、designated requirement
  4. 校验 Gatekeeper / notarization / quarantine 状态
  5. 读取当前用户 TCC.db 中该 bundle id 的历史权限记录
  6. 传入两个 .app 时，检查两者 DR 是否互相兼容，用于判断旧权限是否可能沿用

说明:
  这个脚本只读，不会重置系统权限
EOF
}

fail() {
  printf '%s[ERROR]%s %s\n' "$RED" "$RESET" "$1" >&2
  exit 1
}

warn() {
  printf '%s[WARN]%s %s\n' "$YELLOW" "$RESET" "$1" >&2
}

ok() {
  printf '%s[OK]%s %s\n' "$GREEN" "$RESET" "$1"
}

info() {
  printf '%s[INFO]%s %s\n' "$BLUE" "$RESET" "$1"
}

section() {
  printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$RESET"
}

detail() {
  printf '%s%-28s%s %s\n' "$CYAN" "$1" "$RESET" "$2"
}

status_line() {
  local label="$1"
  local status="$2"
  local message="$3"
  local color="$YELLOW"

  case "$status" in
    PASS) color="$GREEN" ;;
    FAIL) color="$RED" ;;
    WARN) color="$YELLOW" ;;
    INFO) color="$BLUE" ;;
    SKIP) color="$DIM" ;;
  esac

  printf '%s%-20s%s %s[%s]%s %s\n' "$BOLD" "$label" "$RESET" "$color" "$status" "$RESET" "$message"
}

find_default_app() {
  local candidates=(
    "$SYSTEM_APP_PATH"
    "$USER_APP_PATH"
  )

  local dist_app
  while IFS= read -r dist_app; do
    candidates+=("$dist_app")
  done < <(find "$PROJECT_DIST_DIR" -path '*.app' -maxdepth 4 -type d 2>/dev/null | sort)

  for app in "${candidates[@]}"; do
    if [[ -d "$app" ]]; then
      printf '%s\n' "$app"
      return 0
    fi
  done

  return 1
}

find_default_dmg() {
  find "$ARTIFACT_DIST_DIR" -maxdepth 1 -type f -name '*.dmg' -print 2>/dev/null \
    | sort \
    | tail -n 1
}

plist_value() {
  local app="$1"
  local key="$2"
  /usr/libexec/PlistBuddy -c "Print :$key" "$app/Contents/Info.plist" 2>/dev/null || true
}

codesign_text() {
  local app="$1"
  codesign -dvvv "$app" 2>&1 || true
}

print_app_identity() {
  local app="$1"
  local title="$2"
  local info
  info="$(codesign_text "$app")"
  local bundle_id
  local team_id
  local dr
  bundle_id="$(plist_value "$app" CFBundleIdentifier)"
  team_id="$(printf '%s\n' "$info" | sed -n 's/^TeamIdentifier=//p' | head -n 1)"
  dr="$(codesign -d --requirements - "$app" 2>&1 | sed -n 's/^designated => //p')"

  APP_PATH="$app"
  APP_BUNDLE_ID="$bundle_id"
  APP_TEAM_ID="$team_id"
  APP_AUTHORITY="$(printf '%s\n' "$info" | sed -n 's/^Authority=//p' | paste -sd '|' -)"
  APP_DR="$dr"

  section "$title"
  detail 'Path' "$app"
  detail 'CFBundleName' "$(plist_value "$app" CFBundleName)"
  detail 'CFBundleDisplayName' "$(plist_value "$app" CFBundleDisplayName)"
  detail 'CFBundleIdentifier' "$bundle_id"
  detail 'CFBundleShortVersionString' "$(plist_value "$app" CFBundleShortVersionString)"
  detail 'CodeSign Identifier' "$(printf '%s\n' "$info" | sed -n 's/^Identifier=//p' | head -n 1)"
  detail 'TeamIdentifier' "$team_id"
  printf 'Authority:\n'
  printf '%s\n' "$info" | sed -n 's/^Authority=/  - /p'

  printf 'Designated requirement:\n'
  printf '  %s\n' "$dr"
}

verify_distribution_dmg() {
  local dmg="$1"
  local mount_dir=''
  local app=''

  ARTIFACT_PATH="$dmg"

  section "分发物校验"
  detail 'DMG' "$dmg"

  printf '$ xcrun stapler validate "%s"\n' "$dmg"
  if xcrun stapler validate "$dmg"; then
    ARTIFACT_STATUS='PASS: DMG notarization ticket 可验证'
    ok 'DMG notarization ticket 可验证'
  else
    ARTIFACT_STATUS='FAIL: DMG 没有可验证的 notarization ticket'
    warn 'DMG stapler validate 未通过；这份 dmg 不应发给测试或用户'
  fi

  printf '\n$ spctl --assess --type open --verbose=4 "%s"\n' "$dmg"
  local dmg_assess_output
  if dmg_assess_output="$(spctl --assess --type open --verbose=4 "$dmg" 2>&1)"; then
    printf '%s\n' "$dmg_assess_output"
    ok 'spctl open 评估通过'
  else
    printf '%s\n' "$dmg_assess_output"
    if printf '%s\n' "$dmg_assess_output" | grep -q 'Insufficient Context'; then
      warn 'spctl 对未签名 dmg 常返回 Insufficient Context；以 stapler validate 和内部 app 预检为准'
    else
      warn 'spctl open 评估未通过；继续检查内部 app'
    fi
  fi

  mount_dir="$(mktemp -d "/tmp/${APP_DISPLAY_NAME}-dmg.XXXXXX")"
  printf '\n$ hdiutil attach "%s"\n' "$dmg"
  if ! hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount_dir" >/dev/null; then
    ARTIFACT_APP_STATUS='FAIL: DMG 无法挂载'
    rm -rf "$mount_dir"
    fail 'DMG 无法挂载，不能继续检查内部 app'
  fi

  app="$(find "$mount_dir" -maxdepth 1 -type d -name '*.app' -print | sort | head -n 1)"
  if [[ -z "$app" ]]; then
    ARTIFACT_APP_STATUS='FAIL: DMG 内没有 .app'
    hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
    rm -rf "$mount_dir"
    fail 'DMG 内没有 .app'
  fi

  print_app_identity "$app" "DMG 内 app 身份"
  verify_app "$app"
  verify_distribution_readiness "$app"
  print_tcc_records "$(plist_value "$app" CFBundleIdentifier)"
  hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  rm -rf "$mount_dir"
}

verify_distribution_readiness() {
  local app="$1"

  section "Apple 分发预检"

  if ! command -v syspolicy_check >/dev/null 2>&1; then
    ARTIFACT_APP_STATUS='WARN: 当前系统没有 syspolicy_check'
    warn '当前系统没有 syspolicy_check，跳过 Apple 分发预检'
    return
  fi

  printf '$ syspolicy_check distribution "%s"\n' "$app"
  local output
  if output="$(syspolicy_check distribution "$app" 2>&1)"; then
    printf '%s\n' "$output"
    ARTIFACT_APP_STATUS='PASS: 内部 app 通过 Apple 分发预检'
    ok '内部 app 通过 Apple 分发预检'
  else
    printf '%s\n' "$output"
    ARTIFACT_APP_STATUS='FAIL: 内部 app 未通过 Apple 分发预检'
    warn '内部 app 未通过 Apple 分发预检'
  fi
}

verify_app() {
  local app="$1"
  local spctl_status
  spctl_status="$(spctl --status 2>&1 || true)"

  section "签名 / Gatekeeper / 公证校验"

  printf '$ spctl --status\n'
  printf '%s\n' "$spctl_status"
  if printf '%s\n' "$spctl_status" | grep -q 'assessments disabled'; then
    GATEKEEPER_STATUS='WARN: Gatekeeper disabled，本机不能验收用户首次安装'
    warn 'Gatekeeper assessments 当前是 disabled；这台机器不能验证“用户首次安装是否会被拦截”'
  fi

  printf '$ codesign --verify --deep --strict --verbose=2 "%s"\n' "$app"
  if codesign --verify --deep --strict --verbose=2 "$app"; then
    CODESIGN_STATUS='PASS: Developer ID 签名结构有效'
    ok 'codesign 校验通过'
  else
    CODESIGN_STATUS='FAIL: codesign 校验失败'
    warn 'codesign 校验失败'
  fi

  printf '\n$ spctl --assess --type execute --verbose=4 "%s"\n' "$app"
  local assess_output
  if assess_output="$(spctl --assess --type execute --verbose=4 "$app" 2>&1)"; then
    printf '%s\n' "$assess_output"
    if printf '%s\n' "$spctl_status" | grep -q 'assessments disabled'; then
      GATEKEEPER_STATUS='WARN: Gatekeeper disabled，spctl 放行无验收价值'
      warn 'spctl 因 Gatekeeper disabled 而放行，这不是有效的用户安装验收结果'
    elif printf '%s\n' "$assess_output" | grep -q 'source=Unnotarized Developer ID'; then
      GATEKEEPER_STATUS='WARN: 未公证 Developer ID，不能作为正式分发包'
      warn '当前 app 是未公证 Developer ID 签名；不能作为正式分发包'
    else
      GATEKEEPER_STATUS='PASS: Gatekeeper execute 评估通过'
      ok 'Gatekeeper execute 评估通过'
    fi
  else
    printf '%s\n' "$assess_output"
    if printf '%s\n' "$assess_output" | grep -q 'source=Notarized Developer ID'; then
      GATEKEEPER_STATUS='WARN: spctl execute 返回 rejected，但来源是 Notarized Developer ID；以 syspolicy_check distribution 为准'
      warn 'spctl execute 返回 rejected，但来源是 Notarized Developer ID；继续看 syspolicy_check distribution'
    else
      GATEKEEPER_STATUS='FAIL: Gatekeeper execute 评估失败'
      warn 'Gatekeeper execute 评估失败；如果是未加 quarantine 的本地文件，建议再测最终 dmg/zip'
    fi
  fi

  printf '\n$ xcrun stapler validate "%s"\n' "$app"
  if xcrun stapler validate "$app"; then
    NOTARIZATION_STATUS='PASS: notarization ticket 可验证'
    ok 'notarization ticket 可验证'
  else
    NOTARIZATION_STATUS='FAIL: 没有可验证的 notarization ticket'
    warn 'stapler validate 未通过；如果只检查裸 .app，最终分发物仍需确认 dmg/zip 是否已公证并 stapled'
  fi

  printf '\nQuarantine xattr:\n'
  if xattr -p com.apple.quarantine "$app" 2>/dev/null; then
    QUARANTINE_STATUS='PASS: 存在 quarantine，可模拟下载后 Gatekeeper 路径'
    ok '存在 quarantine 属性，可模拟下载后 Gatekeeper 路径'
  else
    QUARANTINE_STATUS='WARN: 没有 quarantine，本地裸 app 不能模拟下载首次打开'
    warn '没有 quarantine 属性；本机直接构建产物不能完整模拟用户下载首次打开'
  fi
}

dump_requirement_file() {
  local app="$1"
  local file="$2"

  codesign -d --requirements - "$app" 2>&1 \
    | sed -n 's/^designated => //p' > "$file"

  [[ -s "$file" ]]
}

compare_requirements() {
  local old_app="$1"
  local new_app="$2"
  local work
  work="$(mktemp -d)"

  local old_req="$work/old.req"
  local new_req="$work/new.req"

  section "DR 兼容性检查"
  if ! dump_requirement_file "$old_app" "$old_req"; then
    warn "无法读取旧 app 的 DR: $old_app"
    rm -rf "$work"
    return
  fi

  if ! dump_requirement_file "$new_app" "$new_req"; then
    warn "无法读取新 app 的 DR: $new_app"
    rm -rf "$work"
    return
  fi

  printf '旧 app DR:\n'
  sed 's/^/  /' "$old_req"
  printf '新 app DR:\n'
  sed 's/^/  /' "$new_req"

  printf '\n检查新 app 是否满足旧 app DR:\n'
  if codesign --verify --verbose=2 -R "$old_req" "$new_app"; then
    DR_COMPAT_STATUS='PASS: 新 app 满足旧 DR，旧 TCC 权限理论上可沿用'
    ok '新 app 满足旧 DR，旧 TCC 权限理论上可沿用'
  else
    DR_COMPAT_STATUS='WARN: 新 app 不满足旧 DR，旧 TCC 权限不能作为有效授权依据'
    warn '新 app 不满足旧 DR，旧 TCC 权限不能作为有效授权依据'
  fi

  printf '\n检查旧 app 是否满足新 app DR:\n'
  if codesign --verify --verbose=2 -R "$new_req" "$old_app"; then
    if [[ "$DR_COMPAT_STATUS" == PASS:* ]]; then
      DR_COMPAT_STATUS='PASS: 两个 app 的 DR 互相兼容'
    fi
    ok '旧 app 满足新 DR，两者互相兼容'
  else
    DR_COMPAT_STATUS='WARN: 两个 app 的 DR 不互相兼容'
    warn '旧 app 不满足新 DR，两者不是同一个 macOS 代码身份'
  fi

  rm -rf "$work"
}

sql_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

print_tcc_records() {
  local bundle_id="$1"
  local db="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
  local escaped_bundle_id
  escaped_bundle_id="$(sql_quote "$bundle_id")"

  section "当前用户 TCC 历史记录"
  printf 'Bundle ID: %s\n' "$bundle_id"
  printf 'DB: %s\n' "$db"

  if [[ ! -r "$db" ]]; then
    TCC_STATUS='WARN: 无法读取 TCC.db'
    warn '当前进程无法读取 TCC.db。给 Terminal / iTerm / Codex Full Disk Access 后再跑，可看到更完整记录。'
    open "$FULL_DISK_ACCESS_URL" >/dev/null 2>&1 || true
    info '已打开 Full Disk Access 设置页。请把当前终端 App（例如 Kitty）加入后，完全退出并重新打开终端。'
    return
  fi

  if ! command -v sqlite3 >/dev/null 2>&1; then
    TCC_STATUS='WARN: 找不到 sqlite3，跳过 TCC.db 查询'
    warn '找不到 sqlite3，跳过 TCC.db 查询'
    return
  fi

  local query="
    SELECT
      service,
      client,
      client_type,
      auth_value,
      auth_reason,
      datetime(last_modified, 'unixepoch', 'localtime') AS last_modified
    FROM access
    WHERE client = '$escaped_bundle_id'
       OR client LIKE '%$escaped_bundle_id%'
    ORDER BY service, last_modified;
  "

  local tcc_output
  if ! tcc_output="$(sqlite3 -header -column "$db" "$query")"; then
    TCC_STATUS='WARN: 读取 TCC.db 失败'
    warn '读取 TCC.db 失败。常见原因是终端没有 Full Disk Access。'
    return
  fi

  printf '%s\n' "$tcc_output"

  TCC_SERVICES="$(sqlite3 "$db" "
    SELECT service || ':' || auth_value
    FROM access
    WHERE client = '$escaped_bundle_id'
       OR client LIKE '%$escaped_bundle_id%'
    ORDER BY service;
  " 2>/dev/null || true)"

  if [[ -n "$TCC_SERVICES" ]]; then
    TCC_STATUS='PASS: 已读取到当前 bundle id 的 TCC 历史记录'
  else
    TCC_STATUS='WARN: 没有读取到当前 bundle id 的 TCC 历史记录'
  fi

  cat <<EOF

auth_value 是 macOS 内部值，不同版本可能变化。这里只用它判断“是否存在历史记录”，不要把它当成唯一真相
如果上面的记录存在，但新 app DR 不满足旧 app DR，就会出现“设置里看起来有权限，但新包实际不可用”的状态

需要做干净测试时，在确认 bundle id 后手动执行：
  tccutil reset Microphone "$bundle_id"
  tccutil reset ScreenCapture "$bundle_id"
  tccutil reset Accessibility "$bundle_id"
EOF
}

has_tcc_service() {
  local service="$1"
  printf '%s\n' "$TCC_SERVICES" | grep -q "^$service:"
}

print_summary() {
  section "诊断结论"

  if [[ -n "$ARTIFACT_PATH" ]]; then
    detail 'Artifact' "$ARTIFACT_PATH"
  fi
  detail 'App' "$APP_PATH"
  detail 'Bundle ID' "$APP_BUNDLE_ID"
  detail 'Team ID' "$APP_TEAM_ID"

  if [[ "$ARTIFACT_STATUS" != '未检查' ]]; then
    case "$ARTIFACT_STATUS" in
      PASS:*) status_line 'DMG ticket' 'PASS' "${ARTIFACT_STATUS#PASS: }" ;;
      FAIL:*) status_line 'DMG ticket' 'FAIL' "${ARTIFACT_STATUS#FAIL: }" ;;
      *) status_line 'DMG ticket' 'SKIP' "$ARTIFACT_STATUS" ;;
    esac
  fi

  if [[ "$ARTIFACT_APP_STATUS" != '未检查' ]]; then
    case "$ARTIFACT_APP_STATUS" in
      PASS:*) status_line '分发预检' 'PASS' "${ARTIFACT_APP_STATUS#PASS: }" ;;
      FAIL:*) status_line '分发预检' 'FAIL' "${ARTIFACT_APP_STATUS#FAIL: }" ;;
      WARN:*) status_line '分发预检' 'WARN' "${ARTIFACT_APP_STATUS#WARN: }" ;;
      *) status_line '分发预检' 'SKIP' "$ARTIFACT_APP_STATUS" ;;
    esac
  fi

  if printf '%s\n' "$APP_AUTHORITY" | grep -q 'Developer ID Application'; then
    status_line '证书身份' 'PASS' 'Developer ID Application，签发身份正确'
  else
    status_line '证书身份' 'FAIL' '不是 Developer ID Application，不能用于正式分发'
  fi

  case "$CODESIGN_STATUS" in
    PASS:*) status_line '签名结构' 'PASS' "${CODESIGN_STATUS#PASS: }" ;;
    FAIL:*) status_line '签名结构' 'FAIL' "${CODESIGN_STATUS#FAIL: }" ;;
    *) status_line '签名结构' 'SKIP' "$CODESIGN_STATUS" ;;
  esac

  case "$NOTARIZATION_STATUS" in
    PASS:*) status_line '公证 ticket' 'PASS' "${NOTARIZATION_STATUS#PASS: }" ;;
    FAIL:*) status_line '公证 ticket' 'FAIL' "${NOTARIZATION_STATUS#FAIL: }" ;;
    *) status_line '公证 ticket' 'SKIP' "$NOTARIZATION_STATUS" ;;
  esac

  case "$GATEKEEPER_STATUS" in
    PASS:*) status_line 'Gatekeeper' 'PASS' "${GATEKEEPER_STATUS#PASS: }" ;;
    FAIL:*) status_line 'Gatekeeper' 'FAIL' "${GATEKEEPER_STATUS#FAIL: }" ;;
    WARN:*) status_line 'Gatekeeper' 'WARN' "${GATEKEEPER_STATUS#WARN: }" ;;
    *) status_line 'Gatekeeper' 'SKIP' "$GATEKEEPER_STATUS" ;;
  esac

  case "$QUARANTINE_STATUS" in
    PASS:*) status_line '下载模拟' 'PASS' "${QUARANTINE_STATUS#PASS: }" ;;
    WARN:*) status_line '下载模拟' 'WARN' "${QUARANTINE_STATUS#WARN: }" ;;
    *) status_line '下载模拟' 'SKIP' "$QUARANTINE_STATUS" ;;
  esac

  case "$TCC_STATUS" in
    PASS:*) status_line 'TCC 数据库' 'PASS' "${TCC_STATUS#PASS: }" ;;
    WARN:*) status_line 'TCC 数据库' 'WARN' "${TCC_STATUS#WARN: }" ;;
    *) status_line 'TCC 数据库' 'SKIP' "$TCC_STATUS" ;;
  esac

  if [[ "$DR_COMPAT_STATUS" != '未检查' ]]; then
    case "$DR_COMPAT_STATUS" in
      PASS:*) status_line '旧权限迁移' 'PASS' "${DR_COMPAT_STATUS#PASS: }" ;;
      WARN:*) status_line '旧权限迁移' 'WARN' "${DR_COMPAT_STATUS#WARN: }" ;;
    esac
  fi

  section "权限记录速读"
  if [[ -z "$TCC_SERVICES" ]]; then
    status_line '权限记录' 'WARN' '没有可用 TCC 记录，无法判断历史授权'
  else
    if has_tcc_service 'kTCCServiceMicrophone'; then
      status_line 'Microphone' 'PASS' 'TCC 中有麦克风历史记录'
    else
      status_line 'Microphone' 'WARN' 'TCC 中没有麦克风历史记录'
    fi

    if has_tcc_service 'kTCCServiceAudioCapture'; then
      status_line 'AudioCapture' 'PASS' 'TCC 中有系统音频捕获历史记录'
    else
      status_line 'AudioCapture' 'WARN' 'TCC 中没有系统音频捕获历史记录'
    fi

    if has_tcc_service 'kTCCServiceScreenCapture'; then
      status_line 'ScreenCapture' 'PASS' 'TCC 中有屏幕录制历史记录'
    else
      status_line 'ScreenCapture' 'WARN' 'TCC 中没有传统屏幕录制历史记录'
    fi

    if has_tcc_service 'kTCCServiceAccessibility'; then
      status_line 'Accessibility' 'PASS' 'TCC 中有辅助功能历史记录'
    else
      status_line 'Accessibility' 'WARN' 'TCC 中没有辅助功能历史记录；Fn / 跨 App 操作可能不可用'
    fi
  fi

  section "下一步"
  if [[ "$NOTARIZATION_STATUS" == FAIL:* ]]; then
    status_line '正式分发' 'FAIL' "当前 app 未公证，不要拿这份 $SYSTEM_APP_PATH 给用户验收"
    printf '  %s建议:%s 先跑 pnpm -F %s build:mac:test，然后检查生成的 dmg/zip。\n' "$BOLD" "$RESET" "$PACKAGE_FILTER"
  fi

  if [[ "$ARTIFACT_STATUS" == PASS:* && "$ARTIFACT_APP_STATUS" == PASS:* ]]; then
    status_line '分发物' 'PASS' 'DMG 和内部 app 已通过分发前校验，可以进入安装后权限测试'
  fi

  if [[ "$GATEKEEPER_STATUS" == *'disabled'* ]]; then
    status_line '安装验收' 'WARN' '本机 Gatekeeper disabled，请换 Gatekeeper enabled 的测试机验收首次打开'
  fi

  if ! has_tcc_service 'kTCCServiceAccessibility'; then
    status_line '权限测试' 'WARN' "要测 Fn / Accessibility，请运行 $DEFAULT_APP_NAME 后在系统设置里给 $APP_DISPLAY_NAME 授权"
  fi
}

main() {
  if [[ "${1:-}" == "--open-full-disk-access" ]]; then
    open "$FULL_DISK_ACCESS_URL"
    exit 0
  fi

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  if [[ "$(uname -s)" != "Darwin" ]]; then
    fail '这个脚本只用于 macOS'
  fi

  local app_a="${1:-}"
  local app_b="${2:-}"

  if [[ -z "$app_a" ]]; then
    app_a="$(find_default_app)" || true
    if [[ -z "$app_a" ]]; then
      app_a="$(find_default_dmg)"
    fi
    [[ -n "$app_a" ]] || fail "找不到默认 $DEFAULT_APP_NAME，也找不到 $ARTIFACT_DIST_DIR 下的 .dmg，请显式传入 .app 或 .dmg 路径"
  fi

  if [[ -f "$app_a" && "$app_a" == *.dmg ]]; then
    [[ -z "$app_b" ]] || fail '传入 .dmg 时不能再传第二个 app 路径'
    verify_distribution_dmg "$app_a"
    print_summary
    exit 0
  fi

  [[ -d "$app_a" ]] || fail "找不到 app 或 dmg: $app_a"
  if [[ -n "$app_b" && ! -d "$app_b" ]]; then
    fail "找不到 app: $app_b"
  fi

  if [[ -n "$app_b" ]]; then
    print_app_identity "$app_a" "旧 app 身份"
    print_app_identity "$app_b" "新 app 身份"
    compare_requirements "$app_a" "$app_b"
    verify_app "$app_b"
    print_tcc_records "$(plist_value "$app_b" CFBundleIdentifier)"
    print_summary
  else
    print_app_identity "$app_a" "app 身份"
    verify_app "$app_a"
    print_tcc_records "$(plist_value "$app_a" CFBundleIdentifier)"
    print_summary
  fi
}

main "$@"
