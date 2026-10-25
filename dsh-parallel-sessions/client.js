/**
 * dsh-parallel-sessions —— 浏览器半边。
 *
 * 在左侧栏加一个「会话状态」入口，对应的中央面板跨所有项目列出会话，并按
 * 会话当前状态上色，一眼看出该点哪一个：
 *
 *   红  待审批      —— 等着你批准一次工具调用
 *   橙  待回答      —— Agent 问了你一个问题，等你补充信息
 *   紫  计划待审    —— 计划模式停在审核步骤
 *   蓝  已完成未看  —— 跑完了但这条会话你还没点开看
 *   绿  运行中      —— 正在干活（脉冲点）
 *   灰  空闲
 *
 * 数据全部来自客户端已有的 Workspace / Session / Status 快照：
 *   useWorkspaces    -> { items: WorkspaceView[], archivedSessionIds, ... }
 *   useSessions      -> { ids, byId: { [id]: { displayTitle, updatedAt, running, blank, origin } } }
 *   useSessionStatus -> Map<sessionId, { running, completionUnread, pendingInteraction?: { kind } }>
 * 状态语义与 DSH 自带侧栏完全一致（待审批 / 计划待审 / 待回答 / 已完成 / 运行中 / 空闲）。
 * 点击一行调用 ctx.get('uiWorkspace').openSession(id) 切回该会话。
 *
 * ⚠️ 第一原则：永远不能让 DSH 启动失败。factory / apply / 每个槽注册各自 try/catch，
 * 最坏结果只是入口不出现，应用照常启动。
 */

window.__ModuleLoader__.load({
  id: 'dsh-parallel-sessions',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;

    function exportNoop() {
      exports.apply = function () {};
      exports.inject = [];
    }

    try {
      var React = require('react');
      if (React === null || typeof React !== 'object' || typeof React.createElement !== 'function') {
        exportNoop();
        return module.exports;
      }
      var h = React.createElement;

      var NS = 'dsh-parallel-sessions';
      var PANEL_ID = 'parallel-sessions';
      var SIDEBAR_ORDER = 30;
      var REFRESH_MS = 30000;

      /* ------------------------------------------------------------ 文案 */

      var zh = {
        panelTitle: '会话状态',
        panelHint: '所有项目的会话总览 · 按「等你处理」优先排序',
        summary: '等你处理 {needs} · 运行中 {running} · 共 {total}',
        onlyNeeds: '只看需要我处理',
        empty: '没有可显示的会话。',
        emptyNeeds: '当前没有需要你处理的会话。',
        loading: '加载中…',
        untitled: '（未命名会话）',
        ungrouped: '未分组',
        sessions: '{n} 个会话',
        statusApproval: '待审批',
        statusQuestion: '待回答',
        statusPlanReview: '计划待审',
        statusDone: '已完成未看',
        statusRunning: '运行中',
        statusIdle: '空闲',
        justNow: '刚刚',
        minutesAgo: '{n} 分钟前',
        hoursAgo: '{n} 小时前',
        daysAgo: '{n} 天前',
      };
      var en = {
        panelTitle: 'Session Status',
        panelHint: 'Every project in one list · waiting on you first',
        summary: '{needs} need you · {running} running · {total} total',
        onlyNeeds: 'Only what needs me',
        empty: 'Nothing to show.',
        emptyNeeds: 'Nothing is waiting on you right now.',
        loading: 'Loading…',
        untitled: '(untitled Session)',
        ungrouped: 'Ungrouped',
        sessions: '{n} sessions',
        statusApproval: 'Needs approval',
        statusQuestion: 'Needs answer',
        statusPlanReview: 'Plan to review',
        statusDone: 'Done, unread',
        statusRunning: 'Running',
        statusIdle: 'Idle',
        justNow: 'just now',
        minutesAgo: '{n}m ago',
        hoursAgo: '{n}h ago',
        daysAgo: '{n}d ago',
      };

      /* ------------------------------------------------------------ 状态模型 */

      // rank 越小越该先看：等你处理的 > 完成未看 > 运行中 > 空闲。
      // text 是词典取不到时的兜底中文，保证任何情况下都会显示状态文字。
      var STATUS = {
        approval: {
          label: 'statusApproval',
          text: '待审批',
          color: 'var(--dsw-alias-state-error-primary)',
          tint: 'rgba(220, 38, 38, 0.07)',
          rank: 0,
        },
        question: {
          label: 'statusQuestion',
          text: '待回答',
          color: 'var(--dsw-alias-state-warn-primary)',
          tint: 'rgba(217, 119, 6, 0.08)',
          rank: 1,
        },
        'plan-review': {
          label: 'statusPlanReview',
          text: '计划待审',
          color: '#8b5cf6',
          tint: 'rgba(139, 92, 246, 0.08)',
          rank: 2,
        },
        done: {
          label: 'statusDone',
          text: '已完成未看',
          color: '#3b82f6',
          tint: 'rgba(59, 130, 246, 0.06)',
          rank: 3,
        },
        running: {
          label: 'statusRunning',
          text: '运行中',
          color: 'var(--dsw-alias-state-success-primary)',
          tint: 'transparent',
          rank: 4,
        },
        idle: {
          label: 'statusIdle',
          text: '空闲',
          color: 'var(--dsw-alias-state-idle-primary)',
          tint: 'transparent',
          rank: 5,
        },
      };

      var NEEDS_ME = { approval: true, question: true, 'plan-review': true, done: true };

      /* ------------------------------------------------------------ 主题色 */

      var T = {
        text: 'var(--dsw-alias-label-primary)',
        dim: 'var(--dsw-alias-label-secondary)',
        faint: 'var(--dsw-alias-label-tertiary)',
        border: 'var(--dsw-alias-border-l1)',
        base: 'var(--dsw-alias-bg-base)',
        brand: 'var(--dsw-alias-brand-primary)',
        hover: 'var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-1))',
      };

      /* ------------------------------------------------------------ 取数辅助 */

      function relTime(ms, t) {
        if (typeof ms !== 'number' || ms <= 0) return '';
        var diff = Date.now() - ms;
        if (diff < 0) diff = 0;
        var minutes = Math.floor(diff / 60000);
        if (minutes < 1) return t('justNow');
        if (minutes < 60) return t('minutesAgo', { n: minutes });
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return t('hoursAgo', { n: hours });
        var days = Math.floor(hours / 24);
        if (days < 30) return t('daysAgo', { n: days });
        try {
          return new Date(ms).toLocaleDateString();
        } catch (_ignored) {
          return '';
        }
      }

      function pendingKindOf(live) {
        var kind = live && live.pendingInteraction ? live.pendingInteraction.kind : undefined;
        if (kind === 'approval' || kind === 'question' || kind === 'plan-review') return kind;
        return null;
      }

      /** 一条会话的展示状态：等你处理 > 完成未看 > 运行中 > 空闲。 */
      function stateOf(summary, statuses) {
        var live = null;
        try {
          if (statuses && typeof statuses.get === 'function') live = statuses.get(summary.id);
        } catch (_ignored) {
          live = null;
        }
        var running = live && typeof live.running === 'boolean'
          ? live.running
          : summary.running === true;
        var pending = pendingKindOf(live);
        if (pending !== null) return { kind: pending, running: running };
        if (live && live.completionUnread === true) return { kind: 'done', running: running };
        if (running) return { kind: 'running', running: true };
        return { kind: 'idle', running: false };
      }

      /**
       * 状态文字。词典取不到（或返回键名）时退到内置中文，
       * 保证色点后面永远有可读的状态词。
       */
      function statusText(kind, t) {
        var meta = STATUS[kind] || STATUS.idle;
        var text = '';
        try {
          text = t(meta.label);
        } catch (_ignored) {
          text = '';
        }
        if (typeof text !== 'string' || text === '' || text === meta.label) text = meta.text;
        return text;
      }

      function visibleSummary(summary, archived) {
        if (!summary) return false;
        if (summary.blank === true) return false;
        if (summary.origin === 'subagent') return false;
        if (archived[summary.id] === true) return false;
        return true;
      }

      function rowOf(summary, statuses) {
        var state = stateOf(summary, statuses);
        return {
          id: summary.id,
          title: typeof summary.displayTitle === 'string' && summary.displayTitle !== ''
            ? summary.displayTitle
            : (typeof summary.title === 'string' && summary.title !== '' ? summary.title : ''),
          updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
          status: state.kind,
          running: state.running,
          rank: STATUS[state.kind].rank,
        };
      }

      function bestRankOf(group) {
        var best = 99;
        for (var i = 0; i < group.rows.length; i += 1) {
          if (group.rows[i].rank < best) best = group.rows[i].rank;
        }
        return best;
      }

      function latestOf(group) {
        var latest = 0;
        for (var i = 0; i < group.rows.length; i += 1) {
          if (group.rows[i].updatedAt > latest) latest = group.rows[i].updatedAt;
        }
        return latest;
      }

      /**
       * 把 Workspace 快照 + Session 摘要拼成分组列表。
       * 组内：状态优先（等你处理的在前），其次最后活跃时间倒序；
       * 组间：先看哪组最需要你，再按最近活动时间。
       */
      function buildGroups(wsSnapshot, sessions, statuses) {
        var workspaces = (wsSnapshot && wsSnapshot.items) || [];
        var archivedList = (wsSnapshot && wsSnapshot.archivedSessionIds) || [];
        var archived = {};
        for (var a = 0; a < archivedList.length; a += 1) archived[archivedList[a]] = true;

        var byId = (sessions && sessions.byId) || {};
        var sessionIds = (sessions && sessions.ids) || [];
        var placed = {};
        var counts = { needs: 0, running: 0, total: 0 };
        var groups = [];

        function sortRows(rows) {
          rows.sort(function (left, right) {
            if (left.rank !== right.rank) return left.rank - right.rank;
            return right.updatedAt - left.updatedAt;
          });
          return rows;
        }

        function count(rows) {
          for (var i = 0; i < rows.length; i += 1) {
            counts.total += 1;
            if (rows[i].rank <= STATUS.done.rank) counts.needs += 1;
            if (rows[i].running) counts.running += 1;
          }
        }

        for (var w = 0; w < workspaces.length; w += 1) {
          var ws = workspaces[w] || {};
          var ids = ws.sessionIds || [];
          var rows = [];
          for (var i = 0; i < ids.length; i += 1) {
            var id = ids[i];
            placed[id] = true;
            var summary = byId[id];
            if (!visibleSummary(summary, archived)) continue;
            rows.push(rowOf(summary, statuses));
          }
          if (rows.length === 0) continue;
          sortRows(rows);
          count(rows);
          groups.push({
            id: ws.workspaceId || ('ws-' + w),
            title: typeof ws.title === 'string' && ws.title !== '' ? ws.title : (ws.path || ''),
            path: typeof ws.path === 'string' ? ws.path : '',
            rows: rows,
          });
        }

        var orphans = [];
        for (var s = 0; s < sessionIds.length; s += 1) {
          var sid = sessionIds[s];
          if (placed[sid] === true) continue;
          if (!visibleSummary(byId[sid], archived)) continue;
          orphans.push(rowOf(byId[sid], statuses));
        }
        if (orphans.length > 0) {
          sortRows(orphans);
          count(orphans);
          groups.push({ id: 'ungrouped', title: '', path: '', rows: orphans, ungrouped: true });
        }

        groups.sort(function (left, right) {
          var rankDiff = bestRankOf(left) - bestRankOf(right);
          if (rankDiff !== 0) return rankDiff;
          return latestOf(right) - latestOf(left);
        });
        return { groups: groups, counts: counts };
      }

      /* ------------------------------------------------------------ 组件 */

      function PanelIcon(props) {
        var size = props && typeof props.size === 'number' ? props.size : 16;
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            style: { display: 'block' },
            'aria-hidden': 'true',
          },
          h('path', { d: 'M3.5 6.5h11' }),
          h('path', { d: 'M3.5 12h17' }),
          h('path', { d: 'M3.5 17.5h8' }),
          h('circle', { cx: 18.5, cy: 6.5, r: 2, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 15.5, cy: 17.5, r: 2, fill: 'currentColor', stroke: 'none', opacity: 0.45 }),
        );
      }

      var STYLE_ID = 'dsh-parallel-sessions/styles';
      var STYLE_TEXT = [
        '@keyframes ps-pulse{0%{box-shadow:0 0 0 0 rgba(64,200,120,.45)}70%{box-shadow:0 0 0 6px rgba(64,200,120,0)}100%{box-shadow:0 0 0 0 rgba(64,200,120,0)}}',
        '.ps-dot-live{animation:ps-pulse 1.8s ease-out infinite}',
        '.ps-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}',
        '.ps-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      ].join('\n');

      function Styles() {
        return h('style', { 'data-plugin-css': STYLE_ID }, STYLE_TEXT);
      }

      function ParallelPanel(props) {
        var t = typeof props.t === 'function' ? props.t : function (key) { return key; };
        var openSession = typeof props.openSession === 'function' ? props.openSession : null;

        var useWorkspaces = typeof props.useWorkspaces === 'function' ? props.useWorkspaces : null;
        var useSessions = typeof props.useSessions === 'function' ? props.useSessions : null;
        var useSessionStatus = typeof props.useSessionStatus === 'function' ? props.useSessionStatus : null;

        var wsSnapshot = useWorkspaces ? useWorkspaces(function (state) { return state; }) : null;
        var sessions = useSessions ? useSessions(function (state) { return state; }) : null;
        var statuses = useSessionStatus ? useSessionStatus(function (state) { return state; }) : null;

        var onlyNeedsState = React.useState(false);
        var onlyNeeds = onlyNeedsState[0];
        var setOnlyNeeds = onlyNeedsState[1];

        var tickState = React.useState(0);
        React.useEffect(function () {
          var timer = setInterval(function () {
            tickState[1](function (value) { return value + 1; });
          }, REFRESH_MS);
          return function () { clearInterval(timer); };
        }, []);

        var view = React.useMemo(function () {
          return buildGroups(wsSnapshot, sessions, statuses);
        }, [wsSnapshot, sessions, statuses]);

        var groups = view.groups;
        if (onlyNeeds) {
          var filtered = [];
          for (var g = 0; g < groups.length; g += 1) {
            var rows = [];
            for (var r = 0; r < groups[g].rows.length; r += 1) {
              if (NEEDS_ME[groups[g].rows[r].status] === true) rows.push(groups[g].rows[r]);
            }
            if (rows.length > 0) {
              filtered.push({
                id: groups[g].id,
                title: groups[g].title,
                path: groups[g].path,
                rows: rows,
                ungrouped: groups[g].ungrouped === true,
              });
            }
          }
          groups = filtered;
        }

        var loading = wsSnapshot === null || sessions === null;

        function handleOpen(sessionId) {
          try {
            if (openSession !== null) openSession(sessionId);
          } catch (_ignored) {
            /* 导航失败不该让面板崩 */
          }
        }

        var header = h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid ' + T.border, flexShrink: 0 } },
          h('span', { style: { color: T.brand, display: 'flex' } }, h(PanelIcon, { size: 18 })),
          h('div', null,
            h('div', { style: { fontSize: 14, fontWeight: 600, color: T.text } }, t('panelTitle')),
            h('div', { style: { fontSize: 11, color: T.faint, marginTop: 2 } }, t('panelHint')),
          ),
          h('div', { style: { flex: 1 } }),
          h('span', { style: { fontSize: 11.5, color: T.dim, fontVariantNumeric: 'tabular-nums' } },
            t('summary', { needs: view.counts.needs, running: view.counts.running, total: view.counts.total })),
          h(
            'label',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.dim, cursor: 'pointer', userSelect: 'none' } },
            h('input', {
              type: 'checkbox',
              checked: onlyNeeds,
              onChange: function (event) { setOnlyNeeds(event.target.checked); },
              style: { margin: 0 },
            }),
            t('onlyNeeds'),
          ),
        );

        var body = [];
        if (loading) {
          body.push(h('div', { key: 'loading', style: { padding: '24px 20px', fontSize: 12.5, color: T.dim } }, t('loading')));
        } else if (groups.length === 0) {
          body.push(h('div', { key: 'empty', style: { padding: '24px 20px', fontSize: 12.5, color: T.dim } },
            onlyNeeds ? t('emptyNeeds') : t('empty')));
        } else {
          for (var gi = 0; gi < groups.length; gi += 1) {
            var group = groups[gi];
            body.push(h(
              'div',
              { key: 'g-' + group.id, style: { padding: '14px 20px 4px' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 } },
                h('span', { style: { fontSize: 12, fontWeight: 600, color: T.text } },
                  group.ungrouped === true ? t('ungrouped') : group.title),
                group.path !== '' && group.ungrouped !== true
                  ? h('span', {
                    style: {
                      fontSize: 10.5,
                      color: T.faint,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 420,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    },
                    title: group.path,
                  }, group.path)
                  : null,
                h('div', { style: { flex: 1 } }),
                h('span', { style: { fontSize: 10.5, color: T.faint } }, t('sessions', { n: group.rows.length })),
              ),
              group.rows.map(function (row) {
                var meta = STATUS[row.status] || STATUS.idle;
                var label = statusText(row.status, t);
                return h(
                  'button',
                  {
                    key: row.id,
                    type: 'button',
                    className: 'ps-row',
                    onClick: function () { handleOpen(row.id); },
                    title: (row.title || t('untitled')) + ' · ' + label + '\n' + row.id,
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      marginBottom: 2,
                      borderRadius: 7,
                      border: 'none',
                      background: meta.tint,
                      color: T.text,
                      fontFamily: 'inherit',
                      fontSize: 12.5,
                      cursor: 'pointer',
                    },
                  },
                  // 色点 + 紧跟其后的状态文字，行与行之间对齐成固定宽度。
                  h('span', {
                    className: row.status === 'running' ? 'ps-dot ps-dot-live' : 'ps-dot',
                    style: {
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: meta.color,
                      opacity: row.status === 'idle' ? 0.55 : 1,
                    },
                  }),
                  h('span', {
                    style: {
                      flexShrink: 0,
                      width: 58,
                      fontSize: 10.5,
                      lineHeight: '16px',
                      color: row.status === 'idle' ? T.faint : meta.color,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    },
                  }, label),
                  h('span', {
                    style: {
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: row.status === 'idle' ? T.dim : T.text,
                      fontWeight: row.rank <= STATUS.done.rank ? 500 : 400,
                    },
                  }, row.title || t('untitled')),
                  h('span', {
                    style: {
                      flexShrink: 0,
                      fontSize: 10.5,
                      color: T.faint,
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: 54,
                      textAlign: 'right',
                    },
                  }, relTime(row.updatedAt, t)),
                );
              }),
            ));
          }
        }

        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: T.base, color: T.text } },
          h(Styles),
          header,
          h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } }, body),
        );
      }

      /* ------------------------------------------------------------ 注册 */

      exports.inject = ['slots', 'locale'];

      exports.apply = function (ctx) {
        try {
          if (!ctx || !ctx.slots) return;

          var localeService = null;
          var uiWorkspace = null;
          try {
            localeService = typeof ctx.get === 'function' ? ctx.get('locale') : null;
          } catch (_ignored) {
            localeService = null;
          }
          try {
            uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : null;
          } catch (_ignored) {
            uiWorkspace = null;
          }

          function openSession(sessionId) {
            var service = uiWorkspace;
            if (service === null || service === undefined) {
              try {
                service = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : null;
              } catch (_ignored) {
                service = null;
              }
            }
            if (service && typeof service.openSession === 'function') service.openSession(sessionId);
          }

          function panelLabel() {
            var localeId = '';
            try {
              var snapshot = localeService && typeof localeService.getLocale === 'function' ? localeService.getLocale() : null;
              localeId = snapshot && typeof snapshot.id === 'string' ? snapshot.id : '';
            } catch (_ignored) {
              localeId = '';
            }
            return localeId.indexOf('en') === 0 ? 'Session Status' : '会话状态';
          }

          if (ctx.locale && typeof ctx.locale.register === 'function') {
            ctx.effect(function () {
              return ctx.locale.register(NS, { zh: zh, en: en });
            }, 'parallel-sessions: dictionaries');
          }

          ctx.slots.inject('sidebar.panellist', function () {
            try {
              return ctx.slots.register({
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: SIDEBAR_ORDER,
                label: panelLabel,
                inject: function () { return {}; },
              }, PanelIcon);
            } catch (error) {
              log(ctx, '注册 sidebar.panellist 失败（已忽略）', error);
              return function () {};
            }
          });

          ctx.slots.inject('main', function () {
            try {
              return ctx.slots.register({
                name: 'main',
                key: PANEL_ID,
                locale: NS,
                inject: function () { return { openSession: openSession }; },
              }, ParallelPanel);
            } catch (error) {
              log(ctx, '注册 main 失败（已忽略）', error);
              return function () {};
            }
          });
        } catch (error) {
          log(ctx, 'apply 失败（已忽略，不影响启动）', error);
        }
      };

      function log(ctx, message, error) {
        try {
          if (ctx && ctx.console && typeof ctx.console.error === 'function') {
            if (error === undefined) ctx.console.error(message);
            else ctx.console.error(message, error);
          }
        } catch (_ignored) {
          /* 日志失败绝不影响主流程 */
        }
      }
    } catch (error) {
      exportNoop();
    }

    return module.exports;
  },
});
