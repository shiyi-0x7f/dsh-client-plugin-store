// Host 半（安装能力经用户明确授权启用）：
// 1. /plugin-store/catalog —— 同源代理社区目录（端点无 CORS 头，浏览器不能直连），缓存一小时。
// 2. /plugin-store/state —— 当前 profile 已安装的插件名列表。
// 3. POST /plugin-store/install | /plugin-store/uninstall —— 在 profile 目录跑 pnpm 并对账层列表。
//
// 变更类端点的 CSRF 防御（loopback HTTP 对本机任意网页开放，必须挡驱动式安装）：
// - 必须携带自定义头 x-plugin-store —— 跨源 JS 设自定义头会触发 CORS 预检，本服务
//   不回 CORS 头，预检必然失败；简单请求（表单/GET）设不了自定义头。
// - Origin 头若存在则必须与本服务同源（浏览器对跨源请求强制带 Origin）。
// - 安装 spec 只接受目录同款的 github:owner/repo#<40位sha> 全格式，杜绝任意 spec 注入。
// 剩余面：Web UI 自身的 XSS 等于本机代码执行——与 harness 既有威胁模型一致，不在
// 本插件防御范围。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'plugin-store'
export const inject = ['webServer']

const DEFAULT_CATALOG_URL = 'https://dshplugin.org/api/github-catalog'
const CACHE_TTL_MS = 60 * 60 * 1000
const OUTPUT_LIMIT = 4000
const INSTALL_SPEC = /^github:[\w.-]+\/[\w.-]+#[0-9a-f]{40}$/
const PACKAGE_NAME = /^[\w.-]+$/

/** 当前 profile 目录：$DSH_HOME 优先，其余按 harness 的 home 约定。 */
function profileDir(profileName) {
  const home = process.env.DSH_HOME && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'profiles', profileName)
}

/** 变更类请求的 CSRF 门：POST + 自定义头 + Origin 同源校验。 */
function guarded(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return false
  }
  const origin = req.headers.origin
  const host = req.headers.host
  if (req.headers['x-plugin-store'] !== '1'
    || (typeof origin === 'string' && origin !== `http://${host}`)) {
    res.writeHead(403, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, output: 'forbidden: cross-origin mutation rejected' }))
    return false
  }
  return true
}

/** 读 JSON 请求体（64KB 上限）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 65536) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

/** 在 profile 目录跑 pnpm，返回 { ok, output }（合并输出尾部）。 */
function runPnpm(dir, args) {
  return new Promise((resolve) => {
    // Windows 的 pnpm 是 .cmd shim，无 shell 会被 spawn 拒绝；CI=true 避免 TTY 确认挂起。
    const child = spawn('pnpm', args, {
      cwd: dir,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true' },
    })
    let output = ''
    const collect = (chunk) => { output = (output + chunk.toString()).slice(-OUTPUT_LIMIT) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => { resolve({ ok: false, output: String(error) }) })
    child.on('close', (code) => { resolve({ ok: code === 0, output }) })
  })
}

/** 对账 dsh.profile.bundles：声明 dsh.bundle 的依赖入层，被卸载的第三方层离层。 */
function reconcile(dir) {
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const dsh = manifest.dsh ?? {}
  const profile = dsh.profile ?? {}
  const bundles = [...(profile.bundles ?? [])]
  const isBundle = (dep) => {
    const pkgPath = join(dir, 'node_modules', dep, 'package.json')
    if (!existsSync(pkgPath)) return false
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      return pkg.dsh?.bundle?.patch !== undefined
    } catch {
      // 坏 manifest 的依赖当普通库对待；boot 阶段自会 fail loud。
      return false
    }
  }
  let changed = false
  for (const dep of dependencies) {
    if (isBundle(dep) && !bundles.includes(dep)) { bundles.push(dep); changed = true }
  }
  for (const listed of [...bundles]) {
    // 模板 bundle（@deepseek-ai/ 前缀、来自安装侧、从不是依赖）永不触碰；
    // 依赖清单已没有、node_modules 也没有的第三方层视为已卸载。
    const removed = !listed.startsWith('@deepseek-ai/')
      && !dependencies.includes(listed)
      && !existsSync(join(dir, 'node_modules', listed, 'package.json'))
    const demoted = dependencies.includes(listed) && !isBundle(listed)
    if (removed || demoted) {
      bundles.splice(bundles.indexOf(listed), 1)
      changed = true
    }
  }
  if (!changed) return
  manifest.dsh = { ...dsh, profile: { ...profile, bundles } }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

export function apply(ctx, config) {
  const catalogUrl = (config && typeof config.catalogUrl === 'string' && config.catalogUrl !== '')
    ? config.catalogUrl
    : DEFAULT_CATALOG_URL
  const profileName = (config && typeof config.profile === 'string' && config.profile !== '')
    ? config.profile
    : 'web'
  let cache = null
  const json = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(value))
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugin-store/catalog',
    async handler(_req, res) {
      try {
        if (cache === null || Date.now() - cache.at > CACHE_TTL_MS) {
          const response = await fetch(catalogUrl, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`catalog fetch failed: HTTP ${response.status}`)
          cache = { at: Date.now(), body: await response.text() }
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(cache.body)
      } catch (error) {
        json(res, 502, { error: String(error) })
      }
    },
  }), 'plugin-store: catalog proxy route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugin-store/state',
    handler(_req, res) {
      try {
        const manifest = JSON.parse(readFileSync(join(profileDir(profileName), 'package.json'), 'utf8'))
        json(res, 200, { installed: Object.keys(manifest.dependencies ?? {}) })
      } catch (error) {
        json(res, 500, { error: String(error) })
      }
    },
  }), 'plugin-store: installed-state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugin-store/install',
    async handler(req, res) {
      if (!guarded(req, res)) return
      try {
        const body = await readBody(req)
        if (typeof body.spec !== 'string' || !INSTALL_SPEC.test(body.spec)) {
          json(res, 400, { ok: false, output: 'invalid install spec; only github:owner/repo#<full sha> is accepted' })
          return
        }
        const dir = profileDir(profileName)
        const result = await runPnpm(dir, ['add', body.spec])
        if (result.ok) reconcile(dir)
        json(res, result.ok ? 200 : 500, result)
      } catch (error) {
        json(res, 500, { ok: false, output: String(error) })
      }
    },
  }), 'plugin-store: install route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugin-store/uninstall',
    async handler(req, res) {
      if (!guarded(req, res)) return
      try {
        const body = await readBody(req)
        const dir = profileDir(profileName)
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        if (typeof body.name !== 'string' || !PACKAGE_NAME.test(body.name)
          || (manifest.dependencies ?? {})[body.name] === undefined) {
          json(res, 400, { ok: false, output: 'not an installed plugin' })
          return
        }
        const result = await runPnpm(dir, ['remove', body.name])
        if (result.ok) reconcile(dir)
        json(res, result.ok ? 200 : 500, result)
      } catch (error) {
        json(res, 500, { ok: false, output: String(error) })
      }
    },
  }), 'plugin-store: uninstall route')
}
