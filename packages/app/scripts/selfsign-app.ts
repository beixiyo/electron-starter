#!/usr/bin/env bun
/**
 * selfsign-app.ts —— 用「自签名证书」给打包后的 .app 一个稳定代码签名身份
 *
 * 为什么需要它：打包默认是 ad-hoc 签名，签名 DR 仅为 cdhash（每次构建都变），
 *   macOS TCC 把「辅助功能」等授权按 DR 记账 → ad-hoc 绑不住 → 授权了也不生效。
 *   自签名证书给 app 一个稳定 DR（identifier + 证书根）→ 授权一次跨重建复用、双击即用。
 *
 * 关键：只要【证书】和【bundle id】不变，DR 就一字不差 → 已授的权自动沿用，重建后不用重新授权。
 *
 * 边界：自签名【过不了】Gatekeeper / 公证，只适合「本机」。分发到别人电脑必须换正规
 *   Developer ID 证书 + 公证（见 docs/mac-code-signing.md 第四节）。
 *
 * 用法（bun 执行）：
 *   bun scripts/selfsign-app.ts setup          # 一次性：生成证书 + 建钥匙串 + 加搜索列表
 *   bun scripts/selfsign-app.ts install [app]  # 把构建产物签好装到 ~/Applications（日常用这个）
 *   bun scripts/selfsign-app.ts sign <app>     # 只给指定 .app 原地重签
 *   bun scripts/selfsign-app.ts cleanup        # 清理：删钥匙串 + 还原搜索列表
 *
 * 可配置（环境变量，均有通用默认值）：
 *   SIGN_CERT_NAME   证书名（默认 'Local CodeSign'）
 *   SIGN_KC_PASS     本地钥匙串密码（默认 'localsign'，仅本机用，无所谓）
 *   SIGN_INSTALL_DIR 安装目录（默认 ~/Applications）
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'

const CERT_NAME = process.env.SIGN_CERT_NAME ?? 'Local CodeSign'
const KC_PASS = process.env.SIGN_KC_PASS ?? 'localsign'
const KC_NAME = 'local-codesign'
const KC = join(homedir(), 'Library/Keychains', `${KC_NAME}.keychain-db`)
const INSTALL_DIR = process.env.SIGN_INSTALL_DIR ?? join(homedir(), 'Applications')
const WORK = join(tmpdir(), 'selfsign-codesign')
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

/** 生成证书 + 建独立钥匙串 + 加搜索列表（一次性） */
async function setup() {
  await $`rm -rf ${WORK}`.nothrow()
  await $`mkdir -p ${WORK}`
  const key = join(WORK, 'key.pem')
  const cert = join(WORK, 'cert.pem')
  const p12 = join(WORK, 'cs.p12')
  const subj = `/CN=${CERT_NAME}/O=${CERT_NAME}`

  console.log('==> 1) 生成自签名证书（带 codeSigning EKU，codesign 才认）')
  await $`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${key} -out ${cert} -days 3650 -subj ${subj} -addext basicConstraints=critical,CA:false -addext keyUsage=critical,digitalSignature -addext extendedKeyUsage=critical,codeSigning`

  console.log('==> 2) 导出 p12（openssl3 必须 -legacy，否则 macOS 导不进）')
  await $`openssl pkcs12 -export -legacy -inkey ${key} -in ${cert} -out ${p12} -passout ${`pass:${KC_PASS}`} -name ${CERT_NAME}`

  console.log('==> 3) 建独立钥匙串并导入（partition-list 放行 codesign 免 GUI 弹窗）')
  await $`security delete-keychain ${KC}`.nothrow()
  await $`security create-keychain -p ${KC_PASS} ${KC}`
  await $`security set-keychain-settings ${KC}`
  await $`security unlock-keychain -p ${KC_PASS} ${KC}`
  await $`security import ${p12} -k ${KC} -P ${KC_PASS} -T /usr/bin/codesign -A`
  await $`security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k ${KC_PASS} ${KC}`.quiet().nothrow()

  console.log('==> 4) 把钥匙串加进搜索列表（否则 codesign 报 no identity found）')
  await $`security list-keychains -d user -s ${KC} ${await otherKeychains()}`

  console.log('==> 完成。身份：')
  await $`security find-identity -p codesigning ${KC}`.nothrow()
}

/** 完整签一个 .app：先 Resources/ 里的 Mach-O（--deep 会漏），再整包；不带 hardened runtime */
async function sign(app: string) {
  if (process.platform !== 'darwin') {
    console.log('⏭  非 macOS，跳过签名（codesign / security 仅 macOS 可用）')
    return
  }
  if (!existsSync(app))
    throw new Error(`找不到 app: ${app}`)
  await $`security unlock-keychain -p ${KC_PASS} ${KC}`.quiet().nothrow() // 重启后钥匙串会锁，先解锁

  if (!(await hasIdentity()))
    throw new Error(`找不到签名证书「${CERT_NAME}」，先跑：pnpm -F app sign:setup`)

  console.log('==> 去隔离属性')
  await $`xattr -cr ${app}`.nothrow()

  console.log('==> 签 Resources/ 里的 Mach-O（--deep 当资源不签，要单独来）')
  const resDir = join(app, 'Contents/Resources')
  if (existsSync(resDir)) {
    for (const name of readdirSync(resDir)) {
      const p = join(resDir, name)
      if (!statSync(p).isFile())
        continue
      const fileType = await $`file -b ${p}`.text()
      if (!fileType.includes('Mach-O'))
        continue
      await $`codesign --force -s ${CERT_NAME} ${p}`
      console.log(`   签 Resources/${name}`)
    }
  }

  console.log('==> --deep 签整包（框架 / Helper / 主程序 + 封印资源）')
  await $`codesign --deep --force -s ${CERT_NAME} ${app}`

  console.log('==> 校验')
  await $`codesign --verify --deep --strict ${app}`
  console.log('VERIFY_OK ✅')
  await printSig(app)
}

/** 日常：把构建产物拷到 ~/Applications 再签（dist 重建碰不到这份；权限自动沿用） */
async function install(appArg?: string) {
  if (process.platform !== 'darwin') {
    console.log('⏭  非 macOS，跳过签名安装（codesign / security 仅 macOS 可用）')
    return
  }

  const built = appArg ?? findBuiltApp()
  if (!built || !existsSync(built)) {
    throw new Error('找不到构建产物，先跑 pnpm -F app build:unpack（或传入 .app 路径）')
  }
  const name = basename(built)
  const dest = join(INSTALL_DIR, name)

  console.log('==> 退出在跑的实例')
  await $`pkill -f ${`${name}/Contents/MacOS`}`.nothrow()
  await Bun.sleep(800)

  console.log(`==> 拷贝 ${built} → ${dest}`)
  await $`mkdir -p ${INSTALL_DIR}`
  await $`rm -rf ${dest}`
  await $`cp -R ${built} ${dest}`

  await sign(dest)
  console.log(`\n✅ 已安装: ${dest}`)
  console.log('   证书 / bundle id 未变 → 已授的辅助功能权限自动沿用，双击即可用')
  console.log('   （只有首次需在 系统设置 → 辅助功能 里授权一次）')
}

/** 清理：还原搜索列表 + 删钥匙串 */
async function cleanup() {
  console.log('==> 从搜索列表移除 build 钥匙串')
  await $`security list-keychains -d user -s ${await otherKeychains()}`
  console.log('==> 删除钥匙串')
  await $`security delete-keychain ${KC}`.nothrow()
  await $`rm -rf ${WORK}`.nothrow()
  console.log('✅ 已清理（已签的 .app 仍可运行，只是无法再重签）')
}

/** 当前用户搜索列表里，除本 build 钥匙串外的其余（保留原有，非破坏） */
async function otherKeychains(): Promise<string[]> {
  const raw = await $`security list-keychains -d user`.text()
  return raw
    .split('\n')
    .map(s => s.trim().replace(/"/g, ''))
    .filter(Boolean)
    .filter(k => !k.includes(KC_NAME))
}

/** 钥匙串里是否已有签名证书（没有则提示先 setup，避免抛 codesign 的 no identity found） */
async function hasIdentity(): Promise<boolean> {
  const r = await $`security find-identity -p codesigning ${KC}`.quiet().nothrow()
  return (r.stdout.toString() + r.stderr.toString()).includes(CERT_NAME)
}

/** 自动定位 electron-builder 产物：dist/dist 下 mac 开头目录里的 .app */
function findBuiltApp(): string | null {
  const base = resolve(SCRIPT_DIR, '..', 'dist', 'dist')
  if (!existsSync(base))
    return null
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith('mac'))
      continue
    const macDir = join(base, dir)
    const app = readdirSync(macDir).find(f => f.endsWith('.app'))
    if (app)
      return join(macDir, app)
  }
  return null
}

/** 打印签名身份与 DR（codesign -d 输出在 stderr） */
async function printSig(p: string) {
  const info = await $`codesign -dvvv ${p}`.quiet().nothrow()
  const text = info.stderr.toString() + info.stdout.toString()
  console.log(`   Identifier=${text.match(/^Identifier=(.*)$/m)?.[1] ?? '?'}`)
  console.log(`   Authority=${text.match(/^Authority=(.*)$/m)?.[1] ?? '(无 / adhoc)'}`)

  const req = await $`codesign -d --requirements - ${p}`.quiet().nothrow()
  const dr = (req.stderr.toString() + req.stdout.toString()).match(/designated =>.*/)?.[0]
  if (dr)
    console.log(`   ${dr}`)
}

const [cmd, arg] = process.argv.slice(2)

async function main() {
  switch (cmd) {
    case 'setup':
      return setup()
    case 'install':
      return install(arg)
    case 'sign':
      if (!arg)
        throw new Error('用法: bun scripts/selfsign-app.ts sign <app>')
      return sign(arg)
    case 'cleanup':
      return cleanup()
    default:
      console.log('用法: bun scripts/selfsign-app.ts {setup | install [app] | sign <app> | cleanup}')
      process.exit(1)
  }
}

main().catch((e: Error) => {
  console.error('❌', e.message)
  process.exit(1)
})
