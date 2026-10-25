/**
 * Host half of the LLM-cost bundle.
 *
 * The Client already sees exact per-Turn token accounting (`TurnTokenUsage`
 * with provider/model routes) and whole-session token totals (`tokenUsage`),
 * but neither carries money, and the loaded Chat window is paged so a
 * Client-side sum over Turn tails undercounts long Sessions.
 *
 * This unit folds the durable log once into per-route token buckets, split by
 * DeepSeek's peak / off-peak tariff window, so the Client receives the
 * whole-session split already computed and only has to multiply by its price
 * table.
 *
 * Fold rules mirror `@deepseek-ai/dsh-token-meter`'s tokenUsage unit: each
 * settled `assistant/message` contributes the usage its own attempt reported,
 * and a step that retried replaces its previous sample instead of adding a
 * second one (`llm/retry-started` closes the replacement slot).
 */

/** Pass-through schema: the registry only calls `.parse` on these. */
const passthrough = { parse: (value) => value };

const emptyBuckets = () => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

const emptyRoute = () => ({ peak: emptyBuckets(), offPeak: emptyBuckets() });

/** Provider-reported sample → the four billed prompt/output buckets. */
function bucketsOf(usage) {
  return {
    uncachedInputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  };
}

function addBuckets(base, delta) {
  return {
    uncachedInputTokens: base.uncachedInputTokens + delta.uncachedInputTokens,
    outputTokens: base.outputTokens + delta.outputTokens,
    cacheReadTokens: base.cacheReadTokens + delta.cacheReadTokens,
    cacheWriteTokens: base.cacheWriteTokens + delta.cacheWriteTokens,
  };
}

function subtractBuckets(base, delta) {
  return {
    uncachedInputTokens: base.uncachedInputTokens - delta.uncachedInputTokens,
    outputTokens: base.outputTokens - delta.outputTokens,
    cacheReadTokens: base.cacheReadTokens - delta.cacheReadTokens,
    cacheWriteTokens: base.cacheWriteTokens - delta.cacheWriteTokens,
  };
}

function sameBuckets(left, right) {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens;
}

/** `provider/model` of the attempt, or undefined when it is not attributed. */
function routeOf(event) {
  const source = event.data?.message?.source;
  if (source === undefined || source === null || source.kind !== 'model') return undefined;
  const { provider, model } = source;
  if (typeof provider !== 'string' || typeof model !== 'string' || provider === '' || model === '') {
    return undefined;
  }
  return `${provider}/${model}`;
}

const shanghaiClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
});

/**
 * 中国法定节假日「放假日期」，全天按空闲时段计。
 * 来源：国务院办公厅《关于2026年部分节假日安排的通知》
 * （国办发明电〔2025〕7号，2025-11-04，
 *  https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm）。
 * 每年 11 月国务院办公厅发布下一年安排，届时更新本表。
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

/** Beijing-time weekday, hour and calendar date for one Unix-ms instant. */
function beijingClock(timeMs) {
  const parts = shanghaiClock.formatToParts(new Date(typeof timeMs === 'number' ? timeMs : Date.now()));
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
  return { weekday, hour, date: `${year}-${month}-${day}` };
}

/**
 * DeepSeek peak window: Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00,
 * excluding Chinese statutory holidays (off-peak all day). Off-peak is half
 * price. Weekend调休补班 days stay off-peak, matching the published rule.
 */
function tariffOf(event) {
  const { weekday, hour, date } = beijingClock(event.time);
  if (HOLIDAYS.has(date)) return 'offPeak';
  if (weekday === 'Sat' || weekday === 'Sun') return 'offPeak';
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18) ? 'peak' : 'offPeak';
}

/** Per-route whole-session token buckets, keyed by `provider/model`. */
const llmCostTokensUnit = {
  key: 'llmCostTokens',
  stateVersion: 3,
  stateSchema: passthrough,
  init: () => ({ routes: {}, last: null }),
  apply: (state, event) => {
    if (event.type === 'llm/retry-started') {
      const last = state.last;
      return last !== null && last.turn === event.data.turn && last.step === event.data.step
        ? { ...state, last: null }
        : state;
    }
    if (event.type !== 'assistant/message') return state;

    const usage = event.data.usage;
    if (usage === undefined || usage === null) return state;
    const route = routeOf(event);
    if (route === undefined) return state;

    const buckets = bucketsOf(usage);
    const tariff = tariffOf(event);
    const last = state.last;
    const replacing = last !== null && last.turn === event.data.turn && last.step === event.data.step;
    if (replacing && last.route === route && last.tariff === tariff && sameBuckets(last.buckets, buckets)) {
      return state;
    }

    const routes = { ...state.routes };
    if (replacing) {
      const previous = routes[last.route] ?? emptyRoute();
      routes[last.route] = {
        ...previous,
        [last.tariff]: subtractBuckets(previous[last.tariff] ?? emptyBuckets(), last.buckets),
      };
    }
    const current = routes[route] ?? emptyRoute();
    routes[route] = {
      ...current,
      [tariff]: addBuckets(current[tariff] ?? emptyBuckets(), buckets),
    };
    return { routes, last: { turn: event.data.turn, step: event.data.step, route, tariff, buckets } };
  },
  // `routes` is replaced only when the fold changed it, so the registry's
  // Object.is gate suppresses unchanged publications for free.
  wire: { viewSchema: passthrough, view: (state) => state.routes },
};

export const inject = ['sessionProjections'];

/** Register the unit; the registration is an effect on this plugin's fiber. */
export function apply(ctx) {
  ctx.effect(() => ctx.sessionProjections.register(llmCostTokensUnit), 'llm-cost: token projection');
}
