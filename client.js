// 浏览器半：设置导航「插件商店」独立分区。经同源路由读社区目录与已装状态，
// 支持搜索、star 排序、触底自动加载；每条可直接 安装/卸载（两击确认，改动
// 重启后生效），也可复制钉死 commit 的安装命令。样式全用 --dsw-alias-* 令牌。
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

    // 变更请求带自定义头（配合 host 半的 CSRF 门）。
    function mutate(path, body) {
      return fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-plugin-store': '1' },
        body: JSON.stringify(body),
      }).then(function (response) {
        return response.json().catch(function () { return { ok: false, output: 'HTTP ' + response.status }; });
      });
    }

    var buttonStyle = {
      padding: '3px 12px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
      fontSize: 12,
      whiteSpace: 'nowrap',
    };

    function Row(props) {
      var entry = props.entry;
      var confirmState = React.useState(false);
      var confirming = confirmState[0];
      var setConfirming = confirmState[1];
      var copiedState = React.useState(false);
      var copied = copiedState[0];
      var setCopied = copiedState[1];
      var action = confirming
        ? function () { setConfirming(false); (props.installed ? props.onUninstall : props.onInstall)(entry); }
        : function () { setConfirming(true); };

      return h('div', {
        style: {
          padding: '10px 0',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
          fontSize: 13,
        },
      },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, entry.name),
          entry.version ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, 'v' + entry.version) : null,
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, '★ ' + entry.stars),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, entry.license || '无许可证'),
          entry.lifecycleScripts && entry.lifecycleScripts.length > 0
            ? h('span', {
              title: '安装时会运行作者的脚本（pnpm 默认拦截，需在 profile 的 pnpm-workspace.yaml 放行）',
              style: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 12 },
            }, '含安装脚本')
            : null,
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            h('button', {
              onClick: function () {
                navigator.clipboard.writeText(installCommand(entry)).then(function () {
                  setCopied(true);
                  setTimeout(function () { setCopied(false); }, 1500);
                });
              },
              title: installCommand(entry),
              style: Object.assign({}, buttonStyle, { color: copied ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)' }),
            }, copied ? '已复制' : '复制命令'),
            h('button', {
              onClick: action,
              onBlur: function () { setConfirming(false); },
              disabled: props.busy,
              style: Object.assign({}, buttonStyle,
                confirming ? { borderColor: 'var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-primary)' } : {},
                props.installed && !confirming ? { color: 'var(--dsw-alias-state-error-primary)' } : {},
                props.busy ? { opacity: 0.6, cursor: 'wait' } : {}),
            }, props.busy
              ? '执行中…'
              : confirming
                ? (props.installed ? '确认卸载？' : '确认安装？')
                : (props.installed ? '卸载' : '安装')),
          ),
        ),
        entry.description
          ? h('div', {
            style: {
              color: 'var(--dsw-alias-label-secondary)',
              marginTop: 2,
              fontSize: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          }, entry.description)
          : null,
        props.notice
          ? h('div', {
            style: {
              marginTop: 4,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: props.notice.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)',
            },
          }, props.notice.text)
          : null,
      );
    }

    function StorePanel() {
      var state = React.useState({ phase: 'loading', catalog: null, error: '' });
      var current = state[0];
      var setState = state[1];
      var installedState = React.useState([]);
      var installed = installedState[0];
      var setInstalled = installedState[1];
      var queryState = React.useState('');
      var query = queryState[0];
      var setQuery = queryState[1];
      var limitState = React.useState(PAGE_SIZE);
      var limit = limitState[0];
      var setLimit = limitState[1];
      var busyState = React.useState(null);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var noticeState = React.useState({});
      var notices = noticeState[0];
      var setNotices = noticeState[1];

      function refreshInstalled() {
        fetch('/plugin-store/state')
          .then(function (response) { return response.json(); })
          .then(function (body) { if (Array.isArray(body.installed)) setInstalled(body.installed); })
          .catch(function () {});
      }

      React.useEffect(function () {
        var alive = true;
        refreshInstalled();
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

      function runOp(entry, path, body, successText) {
        setBusy(entry.repo);
        mutate(path, body).then(function (result) {
          setBusy(null);
          var next = {};
          next[entry.repo] = result.ok
            ? { ok: true, text: successText }
            : { ok: false, text: '失败：' + String(result.output || '').slice(-600) };
          setNotices(Object.assign({}, notices, next));
          refreshInstalled();
        });
      }

      var onInstall = function (entry) {
        runOp(entry, '/plugin-store/install', { spec: 'github:' + entry.repo + '#' + entry.headSha }, '已安装，重启 dsh-shell 后生效');
      };
      var onUninstall = function (entry) {
        runOp(entry, '/plugin-store/uninstall', { name: entry.name }, '已卸载，重启 dsh-shell 后生效');
      };

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
          '插件与 runtime 同权限运行，只安装可信来源；安装/卸载在重启 dsh-shell 后生效。'),
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
          ? h('div', {
            // 固定高度的独立滚动区，触底自动追加下一页。
            style: {
              height: 'calc(100vh - 320px)',
              minHeight: 260,
              overflowY: 'auto',
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 8,
              padding: '0 12px',
              background: 'var(--dsw-alias-bg-layer-1)',
            },
            onScroll: function (event) {
              var el = event.currentTarget;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200 && limit < matches.length) {
                setLimit(limit + PAGE_SIZE);
              }
            },
          },
            matches.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', padding: '10px 0' } }, '没有匹配的插件。') : null,
            matches.slice(0, limit).map(function (entry) {
              return h(Row, {
                key: entry.repo,
                entry: entry,
                installed: installed.indexOf(entry.name) >= 0,
                busy: busy === entry.repo,
                notice: notices[entry.repo],
                onInstall: onInstall,
                onUninstall: onUninstall,
              });
            }),
            limit < matches.length
              ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', padding: '10px 0', textAlign: 'center' } }, '下拉加载更多…')
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
