// 浏览器半：设置 → 通用 里的「插件商店」面板。经同源路由 /plugin-store/catalog
// 读社区目录，支持搜索、按 star 排序，每条给出钉死 commit 的安装命令（一键复制）。
// 样式全部用 --dsw-alias-* 令牌，跟随主题（含第三方皮肤）。
window.__ModuleLoader__.load({
  id: 'dsh-client-plugin-store',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    var PAGE_SIZE = 30;

    function installCommand(entry) {
      return 'dsh plugin --profile web add github:' + entry.repo + '#' + entry.headSha;
    }

    function Row(props) {
      var entry = props.entry;
      var copied = React.useState(false);
      var isCopied = copied[0];
      var setCopied = copied[1];
      return h('div', {
        style: {
          padding: '10px 0',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
          fontSize: 13,
        },
      },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, entry.name),
          entry.version ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'v' + entry.version) : null,
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '★ ' + entry.stars),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, entry.license || '无许可证'),
          entry.lifecycleScripts && entry.lifecycleScripts.length > 0
            ? h('span', {
              title: '安装时会运行作者的脚本（pnpm 默认拦截，需在 profile 的 pnpm-workspace.yaml 放行）',
              style: { color: 'var(--dsw-alias-state-warn-primary)' },
            }, '含安装脚本')
            : null,
          h('button', {
            onClick: function () {
              navigator.clipboard.writeText(installCommand(entry)).then(function () {
                setCopied(true);
                setTimeout(function () { setCopied(false); }, 1500);
              });
            },
            style: {
              marginLeft: 'auto',
              padding: '2px 10px',
              borderRadius: 6,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-2)',
              color: isCopied ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-primary)',
              cursor: 'pointer',
              fontSize: 12,
            },
          }, isCopied ? '已复制' : '复制安装命令'),
        ),
        entry.description
          ? h('div', {
            style: {
              color: 'var(--dsw-alias-label-secondary)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          }, entry.description)
          : null,
      );
    }

    function StorePanel() {
      var state = React.useState({ phase: 'loading', catalog: null, error: '' });
      var current = state[0];
      var setState = state[1];
      var queryState = React.useState('');
      var query = queryState[0];
      var setQuery = queryState[1];
      var limitState = React.useState(PAGE_SIZE);
      var limit = limitState[0];
      var setLimit = limitState[1];

      React.useEffect(function () {
        var alive = true;
        fetch('/plugin-store/catalog')
          .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
          .then(function (result) {
            if (!alive) return;
            if (!result.ok || !Array.isArray(result.body.plugins)) {
              setState({ phase: 'error', catalog: null, error: String(result.body && result.body.error || '目录响应无效') });
            } else {
              setState({ phase: 'ready', catalog: result.body, error: '' });
            }
          })
          .catch(function (error) {
            if (alive) setState({ phase: 'error', catalog: null, error: String(error) });
          });
        return function () { alive = false; };
      }, []);

      var matches = [];
      if (current.phase === 'ready') {
        var needle = query.trim().toLowerCase();
        matches = current.catalog.plugins.filter(function (entry) {
          if (!entry || typeof entry.repo !== 'string' || typeof entry.headSha !== 'string') return false;
          if (needle === '') return true;
          return (entry.name || '').toLowerCase().indexOf(needle) >= 0
            || (entry.description || '').toLowerCase().indexOf(needle) >= 0
            || (entry.topics || []).some(function (topic) { return String(topic).toLowerCase().indexOf(needle) >= 0; });
        }).sort(function (a, b) { return (b.stars || 0) - (a.stars || 0); });
      }

      return h('div', { style: { padding: '4px 2px' } },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 8 } },
          h('span', { style: { fontWeight: 600, fontSize: 15, color: 'var(--dsw-alias-label-primary)' } }, '插件商店'),
          current.phase === 'ready'
            ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '共 ' + current.catalog.plugins.length + ' 个（社区索引 dshplugin.org）')
            : null,
        ),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10 } },
          '插件与 runtime 同权限运行，只安装可信来源；复制命令后在 harness 终端执行，重启后生效。'),
        h('input', {
          value: query,
          placeholder: '搜索插件（名称 / 描述 / 标签）…',
          onChange: function (event) { setQuery(event.target.value); setLimit(PAGE_SIZE); },
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13,
            marginBottom: 8,
          },
        }),
        current.phase === 'loading' ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', padding: '8px 0' } }, '正在加载社区目录…') : null,
        current.phase === 'error' ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', padding: '8px 0' } }, '目录加载失败：' + current.error) : null,
        current.phase === 'ready'
          ? h('div', null,
            matches.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', padding: '8px 0' } }, '没有匹配的插件。') : null,
            matches.slice(0, limit).map(function (entry) { return h(Row, { key: entry.repo, entry: entry }); }),
            matches.length > limit
              ? h('button', {
                onClick: function () { setLimit(limit + PAGE_SIZE); },
                style: {
                  marginTop: 6,
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: 'var(--dsw-alias-label-primary)',
                  cursor: 'pointer',
                  fontSize: 12,
                },
              }, '加载更多（剩余 ' + (matches.length - limit) + '）')
              : null,
          )
          : null,
      );
    }

    exports.name = 'plugin-store-panel';
    exports.inject = ['slots'];
    exports.apply = function (ctx) {
      // 独立设置分区：设置导航里自己的「插件商店」条目，整块面板区域。
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'plugin-store',
          order: 60,
          label: function () { return '插件商店'; },
        }, StorePanel);
      });
    };

    return module.exports;
  }
});
