# dsh-client-plugin-store

DeepSeek Harness Web UI 的社区插件商店：设置导航里的独立「插件商店」分区，浏览、搜索 dshplugin.org 社区索引（4000+ 插件），按 star 排序，每条给出钉死 commit 的安装命令一键复制。

A community plugin store panel for the DeepSeek Harness Web UI: browse and search the dshplugin.org index from Settings, with copyable commit-pinned install commands.

## 安装

```sh
dsh plugin --profile web add github:shiyi-0x7f/dsh-client-plugin-store
```

重启 `dsh --profile web`（或 dsh-shell）后，打开 设置，左侧导航即有独立的「插件商店」分区。

## 机制

- host 半在 `ctx.webServer` 注册同源路由 `/plugin-store/catalog` 代理社区目录（端点无 CORS 头，浏览器不能直连），内存缓存一小时；`config.catalogUrl` 可换源。
- 浏览器半（零构建懒 CJS 工厂）经 `ctx.slots` 注册 `settings.section` 独立分区（自带导航条目与整页面板）；样式全用 `--dsw-alias-*` 令牌，跟随任意主题/皮肤。
- **直接安装 / 卸载**：面板内两击确认，重启后生效；同时保留「复制命令」手动方式。变更端点带三层防护（自定义请求头、Origin 同源校验、安装 spec 仅接受目录同款的 `github:owner/repo#完整sha` 白名单），设计缘由见 `index.js` 头部注释。

## License

MIT
