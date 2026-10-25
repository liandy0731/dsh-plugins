/**
 * Client half of the LLM-cost bundle.
 *
 * Two additions only, both read-only:
 *   - `conversation.composer.dock`: one compact chip showing the Session's
 *     ACCUMULATED cost, beside the shipped session stats.
 *   - `conversation.chat.turnTail`: one compact chip showing ONE Turn's cost
 *     in its footer.
 *
 * Both chips open the same kind of trigger-anchored dialog the shipped token
 * usage pill uses (same panel metrics, same <dl> rows, Escape / outside-click
 * to dismiss), so the two read as one family.
 *
 * Session totals come from the Host `llmCostTokens` projection (whole log, per
 * provider/model route, split by peak / off-peak tariff); per-Turn figures come
 * from the Chat layer's own `TurnTokenUsage`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-llm-cost',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    let createPortal = null;
    try {
      const ReactDOM = require('react-dom');
      if (ReactDOM !== null && typeof ReactDOM.createPortal === 'function') createPortal = ReactDOM.createPortal;
    } catch {
      createPortal = null;
    }

    const NS = 'ui-llm-cost';
    const PER_MILLION = 1e6;

    /* ---------- styles (metrics copied from the shipped stat dialog) ---------- */

    const CSS_ID = 'dsh-llm-cost/chips.css';
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-llm-cost';
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = [
        '.llmcost_root{min-width:0;display:inline-flex;align-self:center;flex:0 0 auto}',
        '.llmcost_inline{order:1}',
        // The running DSH wraps the usage pill and the clock in one inline-flex
        // span, so a slot entry can only land before or after that pair. Flatten
        // the wrapper into the action row's flex context, then order ourselves
        // between the usage pill and the clock.
        '[data-turn-tail] [class*="endInfo"]{display:contents}',
        '[data-turn-tail] [class*="timeEnd"]{order:2}',
        '.llmcost_trigger{min-width:0;height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px 8px;display:inline-flex;align-items:center;gap:4px;border:none;border-radius:28px;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}',
        '.llmcost_trigger:hover,.llmcost_trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
        '.llmcost_trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        '.llmcost_panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);padding:16px;border:0;border-radius:12px;opacity:1;background-color:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#ffffff));background-image:linear-gradient(var(--dsw-specific-menu,#ffffff),var(--dsw-specific-menu,#ffffff));box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:default}',
        '.llmcost_title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}',
        '.llmcost_titleValue{font-variant-numeric:tabular-nums}',
        '.llmcost_titleRule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
        '.llmcost_details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary)}',
        '.llmcost_details dt,.llmcost_details dd{min-width:0;margin:0}',
        '.llmcost_details dd{text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
        '.llmcost_details .llmcost_route{overflow-wrap:anywhere}',
        '.llmcost_note{margin-top:10px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      ].join('\n');
      document.head.appendChild(tag);
    }

    /* ---------- prices (元 / 百万 token, 2026-10 官网公开价) ---------- */

    /**
     *   input      = 输入（缓存未命中）
     *   cacheRead  = 输入（缓存命中）
     *   cacheWrite = 缓存写入（DeepSeek 按未命中价计）
     *   output     = 输出（含推理 token）
     * 键可以是模型 id，也可以是完整路由（provider/model，优先匹配）。
     * 来源：DeepSeek https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
     *       GLM      https://docs.bigmodel.cn/cn/guide/start/pricing
     */
    const deepseekFlash = {
      peak: { input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8 },
      offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
    };
    const deepseekPro = {
      peak: { input: 9, cacheRead: 0.3, cacheWrite: 9, output: 27 },
      offPeak: { input: 4.5, cacheRead: 0.15, cacheWrite: 4.5, output: 13.5 },
    };
    const glm53 = {
      peak: { input: 8, cacheRead: 2, cacheWrite: 8, output: 28 },
      offPeak: { input: 8, cacheRead: 2, cacheWrite: 8, output: 28 },
    };
    const glm53Flash = {
      peak: { input: 0.8, cacheRead: 0.23, cacheWrite: 0.8, output: 2.8 },
      offPeak: { input: 0.8, cacheRead: 0.23, cacheWrite: 0.8, output: 2.8 },
    };
    const glm53FlashX = {
      peak: { input: 2, cacheRead: 0.57, cacheWrite: 2, output: 7 },
      offPeak: { input: 2, cacheRead: 0.57, cacheWrite: 2, output: 7 },
    };

    const PRICES = {
      'deepseek-flash': deepseekFlash,
      'deepseek-v4-flash': deepseekFlash,
      'deepseek-v4-flash-vision-exp': deepseekFlash,
      'deepseek-v4-pro': deepseekPro,
      'glm-5.3': glm53,
      'glm-5.3-flash': glm53Flash,
      // 官网未单列 Highspeed，按同代 FlashX 档估算
      'glm-5.3-highspeed': glm53FlashX,
    };
    const DEFAULT_PRICE = deepseekFlash;
    const FREE_PRICE = {
      peak: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      offPeak: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    };

    function modelOf(route) {
      if (typeof route !== 'string' || route === '') return '';
      const slash = route.indexOf('/');
      return slash >= 0 ? route.slice(slash + 1) : route;
    }

    /** OpenCode 免费模型（-free 后缀 / opencode 路由）按 0 计。 */
    function isFreeRoute(route) {
      return modelOf(route).endsWith('-free') || String(route).startsWith('opencode/');
    }

    function priceOf(route) {
      if (isFreeRoute(route)) return FREE_PRICE;
      if (typeof route === 'string') {
        const exact = PRICES[route];
        if (exact !== undefined) return exact;
        const byModel = PRICES[modelOf(route)];
        if (byModel !== undefined) return byModel;
      }
      return DEFAULT_PRICE;
    }

    const BUCKET_KEYS = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'];
    const PRICE_KEYS = {
      uncachedInputTokens: 'input',
      cacheReadTokens: 'cacheRead',
      cacheWriteTokens: 'cacheWrite',
      outputTokens: 'output',
    };

    function bucketList(usage) {
      return {
        uncachedInputTokens: usage?.uncachedInputTokens || 0,
        cacheReadTokens: usage?.cacheReadTokens || 0,
        cacheWriteTokens: usage?.cacheWriteTokens || 0,
        outputTokens: usage?.outputTokens || 0,
      };
    }

    function bucketCost(price, key, tokens) {
      return (tokens || 0) * price[PRICE_KEYS[key]] / PER_MILLION;
    }

    function tariffCost(price, buckets) {
      if (buckets === undefined || buckets === null) return 0;
      let sum = 0;
      for (const key of BUCKET_KEYS) sum += bucketCost(price, key, buckets[key]);
      return sum;
    }

    function routeCost(route, split) {
      if (split === undefined || split === null || typeof split !== 'object') return 0;
      const price = priceOf(route);
      const legacy = split.peak === undefined && split.offPeak === undefined;
      if (legacy) return tariffCost(price.peak, split);
      return tariffCost(price.peak, split.peak) + tariffCost(price.offPeak, split.offPeak);
    }

    /** 高峰：北京时间周一至周五 09:00–12:00、14:00–18:00；法定节假日与其余时段空闲（半价）。 */
    const beijingClock = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    });

    /**
     * 2026 年法定节假日「放假日期」，全天按空闲时段计。
     * 来源：国务院办公厅《关于2026年部分节假日安排的通知》（国办发明电〔2025〕7号）。
     */
    const HOLIDAYS = new Set([
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07',
    ]);

    function tariffAt(timeMs) {
      const parts = beijingClock.formatToParts(new Date(typeof timeMs === 'number' ? timeMs : Date.now()));
      let weekday = '';
      let hour = 0;
      let year = '';
      let month = '';
      let day = '';
      for (const part of parts) {
        if (part.type === 'weekday') weekday = part.value;
        else if (part.type === 'hour') hour = Number(part.value) % 24;
        else if (part.type === 'year') year = part.value;
        else if (part.type === 'month') month = part.value;
        else if (part.type === 'day') day = part.value;
      }
      if (HOLIDAYS.has(`${year}-${month}-${day}`)) return 'offPeak';
      if (weekday === 'Sat' || weekday === 'Sun') return 'offPeak';
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18) ? 'peak' : 'offPeak';
    }

    function money(value) {
      const amount = Number.isFinite(value) ? value : 0;
      return `¥${amount.toFixed(4)}`;
    }

    function tokens(value) {
      return Number(value || 0).toLocaleString('zh-CN');
    }

    function routeLabel(provider, model) {
      if (typeof provider !== 'string' || typeof model !== 'string') return undefined;
      return `${provider}/${model}`;
    }

    /* ---------- breakdowns ---------- */

    /** Session breakdown from the whole-log projection. */
    function sessionBreakdown(routes) {
      if (routes === undefined || routes === null) return null;
      const entries = [];
      let total = 0;
      for (const [route, split] of Object.entries(routes)) {
        const price = priceOf(route);
        const legacy = split?.peak === undefined && split?.offPeak === undefined;
        const peakBuckets = legacy ? null : split?.peak;
        const offPeakBuckets = legacy ? split : split?.offPeak;
        const peakCost = peakBuckets === null ? 0 : tariffCost(price.peak, peakBuckets);
        const offPeakCost = tariffCost(price.offPeak, offPeakBuckets);
        if (peakCost === 0 && offPeakCost === 0) continue;
        total += peakCost + offPeakCost;
        entries.push({ route, price, peakBuckets, offPeakBuckets, peakCost, offPeakCost });
      }
      if (entries.length === 0) return null;
      return { total, entries };
    }

    /** One Turn's `turn-tail` data (token usage, time, closing provenance) by assistant message id. */
    function turnTailDataOf(snapshot, messageId) {
      const nodes = snapshot?.nodes;
      const locations = snapshot?.locations;
      if (nodes === undefined || locations === undefined) return null;
      let turn = null;
      let values;
      try {
        values = nodes.values();
      } catch {
        return null;
      }
      for (const node of values) {
        // Assistant rows are keyed 'assistant-step'; match on the durable message
        // id instead of the renderer kind so a kind rename cannot blank the chip.
        if (node?.data?.finalNode?.messageId === messageId) {
          turn = node.data.turn;
          break;
        }
      }
      if (turn === null) return null;
      let keys;
      try {
        keys = locations.getTurn(turn);
      } catch {
        return null;
      }
      if (!Array.isArray(keys)) return null;
      for (const key of keys) {
        let node;
        try {
          node = nodes.get(key);
        } catch {
          node = undefined;
        }
        if (node?.kind === 'turn-tail' && node.data?.tokenUsage !== undefined) return node.data;
      }
      return null;
    }

    /** Money + detail for one Turn, from its `turn-tail` data. */
    function turnEntryOf(data) {
      const usage = data?.tokenUsage;
      if (usage === undefined || usage === null) return null;
      const provenance = data.closing?.finalNode?.provenance;
      const fallbackRoute = routeLabel(provenance?.provider, provenance?.model);
      let route = fallbackRoute;
      if (Array.isArray(usage.routes) && usage.routes.length === 1) {
        route = routeLabel(usage.routes[0]?.provider, usage.routes[0]?.model) ?? fallbackRoute;
      }
      const tariff = tariffAt(data.time);
      const price = priceOf(route);
      const buckets = bucketList(usage);
      const total = Math.round(tariffCost(price[tariff], buckets) * 1e6) / 1e6;
      return {
        total,
        route,
        price,
        peakBuckets: tariff === 'peak' ? buckets : null,
        offPeakBuckets: tariff === 'offPeak' ? buckets : null,
        peakCost: tariff === 'peak' ? total : 0,
        offPeakCost: tariff === 'offPeak' ? total : 0,
      };
    }

    /* ---------- anchored dialog seat (same behaviour as the shipped stat dialog) ---------- */

    function useAnchoredDialog() {
      const [open, setOpen] = React.useState(false);
      const rootRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const [pos, setPos] = React.useState(null);

      React.useLayoutEffect(() => {
        if (!open) {
          setPos(null);
          return;
        }
        const measure = () => {
          const anchor = rootRef.current?.getBoundingClientRect?.();
          const panel = panelRef.current;
          if (anchor === undefined) return;
          const width = panel?.offsetWidth || 300;
          const height = panel?.offsetHeight || 200;
          const margin = 8;
          let left = anchor.left + anchor.width / 2 - width / 2;
          left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
          let top = anchor.top - 8 - height;
          if (top < margin) top = anchor.bottom + 8;
          setPos({ left, top });
        };
        measure();
        const frame = requestAnimationFrame(measure);
        window.addEventListener('resize', measure);
        return () => {
          cancelAnimationFrame(frame);
          window.removeEventListener('resize', measure);
        };
      }, [open]);

      React.useEffect(() => {
        if (!open) return;
        const onPointerDown = (event) => {
          const target = event.target;
          if (rootRef.current?.contains?.(target)) return;
          if (panelRef.current?.contains?.(target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);

      return { open, setOpen, rootRef, panelRef, pos };
    }

    const MEASURE_STYLE = { left: 0, top: 0, visibility: 'hidden' };

    function DialogPanel({ id, label, title, total, rows, note, onClose, panelRef, style }) {
      return h('div', {
        ref: panelRef,
        className: 'llmcost_panel',
        role: 'dialog',
        'aria-label': label,
        style,
      },
        h('div', { className: 'llmcost_title' },
          h('span', null, title),
          h('span', { className: 'llmcost_titleValue' }, money(total)),
        ),
        h('div', { className: 'llmcost_titleRule', 'aria-hidden': true }),
        h('dl', { className: 'llmcost_details' }, ...rows),
        h('div', { className: 'llmcost_note' }, note),
      );
    }

    function detailRows(entry, t) {
      const rows = [];
      rows.push(h('dt', { key: 'model-k' }, t('model')));
      rows.push(h('dd', { key: 'model-v', className: 'llmcost_route' }, entry.route ?? t('unknownModel')));

      const tariffs = [];
      if (entry.peakBuckets !== null && entry.peakCost > 0) tariffs.push({ key: 'peak', label: t('peak'), price: entry.price.peak, buckets: entry.peakBuckets, cost: entry.peakCost });
      if (entry.offPeakBuckets !== null && entry.offPeakCost > 0) tariffs.push({ key: 'offPeak', label: t('offPeak'), price: entry.price.offPeak, buckets: entry.offPeakBuckets, cost: entry.offPeakCost });

      for (const tariff of tariffs) {
        rows.push(h('dt', { key: `${tariff.key}-k` }, `${t('tariff')} · ${tariff.label}`));
        rows.push(h('dd', { key: `${tariff.key}-v` }, t('unitPrice', {
          input: tariff.price.input,
          hit: tariff.price.cacheRead,
          output: tariff.price.output,
        })));
        const labels = {
          uncachedInputTokens: t('inputMiss'),
          cacheReadTokens: t('inputHit'),
          cacheWriteTokens: t('cacheWrite'),
          outputTokens: t('output'),
        };
        for (const key of BUCKET_KEYS) {
          const value = tariff.buckets?.[key] || 0;
          if (value <= 0) continue;
          rows.push(h('dt', { key: `${tariff.key}-${key}-k`, style: { paddingLeft: '10px' } }, labels[key]));
          rows.push(h('dd', { key: `${tariff.key}-${key}-v` }, `${tokens(value)} · ${money(bucketCost(tariff.price, key, value))}`));
        }
      }

      rows.push(h('dt', { key: 'total-k' }, t('total')));
      rows.push(h('dd', { key: 'total-v' }, money((entry.peakCost ?? 0) + (entry.offPeakCost ?? 0))));
      return rows;
    }

    /* ---------- contributions ---------- */

    function Chip({ rootRef, open, onToggle, mathLabel, amount, t, inline }) {
      return h('span', { ref: rootRef, className: inline === true ? 'llmcost_root llmcost_inline' : 'llmcost_root' },
        h('button', {
          type: 'button',
          className: 'llmcost_trigger',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          onClick: onToggle,
        },
          h('span', null, t(mathLabel, { amount: money(amount) })),
        ),
      );
    }

    /** Session-accumulated cost chip in the ambient composer dock. */
    function SessionCost({ useProjection, t }) {
      const routes = useProjection('llmCostTokens');
      const breakdown = React.useMemo(() => sessionBreakdown(routes), [routes]);
      const { open, setOpen, rootRef, panelRef, pos } = useAnchoredDialog();
      if (breakdown === null) return null;

      const panel = h(DialogPanel, {
        label: t('dialogSession'),
        title: t('dialogSession'),
        total: breakdown.total,
        rows: breakdown.entries.flatMap((entry, index) => detailRows(entry, t).map((row) => React.cloneElement(row, { key: `r${index}-${row.key}` }))),
        note: t('note'),
        panelRef,
        style: pos ?? MEASURE_STYLE,
      });

      return h(React.Fragment, null,
        h(Chip, {
          rootRef,
          open,
          onToggle: () => setOpen((value) => !value),
          mathLabel: 'chipSession',
          amount: breakdown.total,
          t,
        }),
        open && (createPortal !== null ? createPortal(panel, document.body) : panel),
      );
    }

    /** One Turn's cost chip, inline in the finalized-assistant action row (next to the usage pill). */
    function TurnCostAction({ messageId, useChat, t }) {
      const data = useChat((snapshot) => turnTailDataOf(snapshot, messageId));
      const { open, setOpen, rootRef, panelRef, pos } = useAnchoredDialog();
      const entry = React.useMemo(() => turnEntryOf(data), [data]);
      if (entry === null) return null;

      const panel = h(DialogPanel, {
        label: t('dialogTurn'),
        title: t('dialogTurn'),
        total: entry.total,
        rows: detailRows(entry, t),
        note: t('note'),
        panelRef,
        style: pos ?? MEASURE_STYLE,
      });

      return h(React.Fragment, null,
        h(Chip, {
          rootRef,
          open,
          onToggle: () => setOpen((value) => !value),
          mathLabel: 'chipTurn',
          amount: entry.total,
          t,
          inline: true,
        }),
        open && (createPortal !== null ? createPortal(panel, document.body) : panel),
      );
    }

    const zh = {
      chipSession: '累计 {amount}',
      chipTurn: '本轮 {amount}',
      dialogSession: '本次会话费用',
      dialogTurn: '本轮费用',
      model: '模型',
      tariff: '时段',
      peak: '高峰',
      offPeak: '空闲',
      unitPrice: '单价 {input}/{hit}/{output}',
      inputMiss: '输入（未命中）',
      inputHit: '输入（缓存命中）',
      cacheWrite: '缓存写入',
      output: '输出',
      total: '合计',
      unknownModel: '未知模型',
      note: '按官网单价 × token 数本地估算，不是账单；子代理在独立会话中运行，不计入。单价单位：元/百万 token（输入/命中/输出）。',
    };
    const en = {
      chipSession: 'Total {amount}',
      chipTurn: 'Turn {amount}',
      dialogSession: 'Session cost',
      dialogTurn: 'Turn cost',
      model: 'Model',
      tariff: 'Tariff',
      peak: 'Peak',
      offPeak: 'Off-peak',
      unitPrice: 'Price {input}/{hit}/{output}',
      inputMiss: 'Input (miss)',
      inputHit: 'Input (cache hit)',
      cacheWrite: 'Cache write',
      output: 'Output',
      total: 'Total',
      unknownModel: 'Unknown model',
      note: 'Local estimate from official prices × tokens, not a bill. Subagent sessions are excluded. Prices are CNY per 1M tokens (input / hit / output).',
    };

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-cost: dictionaries');
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'llm-cost-session',
          order: 5,
          locale: NS,
        }, SessionCost));
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'llm-cost-turn',
          order: 20,
          locale: NS,
        }, TurnCostAction));
      },
    };
  },
});
