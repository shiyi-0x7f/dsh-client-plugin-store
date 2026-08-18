// Host 半：把社区插件目录（默认 dshplugin.org 的 github-catalog）以同源路由
// /plugin-store/catalog 代理给浏览器——目录端点不带 CORS 头，浏览器不能直连。
// 内存缓存一小时；抓取失败回 502 并带原因，浏览器面板原文展示。
// 注意：本插件不提供任何"安装"端点——loopback HTTP 对本机任意网页开放，
// 一个能装插件的接口等于把任意代码执行暴露给驱动式攻击。安装留给用户复制
// 命令自己执行。
export const name = 'plugin-store'
export const inject = ['webServer']

const DEFAULT_CATALOG_URL = 'https://dshplugin.org/api/github-catalog'
const CACHE_TTL_MS = 60 * 60 * 1000

export function apply(ctx, config) {
  const catalogUrl = (config && typeof config.catalogUrl === 'string' && config.catalogUrl !== '')
    ? config.catalogUrl
    : DEFAULT_CATALOG_URL
  let cache = null

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
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: String(error) }))
      }
    },
  }), 'plugin-store: catalog proxy route')
}
