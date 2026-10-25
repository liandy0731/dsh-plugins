# dsh-llm-cost

A cost meter for [DeepSeek Harness](https://github.com/deepseek-ai): shows the accumulated cost of the current session below the composer and the cost of each turn in its action row, next to the token-usage pill. Click either chip for a breakdown.

All numbers are local estimates: **official model prices × token counts**, not a bill.

## Features

- **Session total** — `累计 ¥x.xxxx` appended to the existing stats row below the composer; it covers the whole session (all turns, all models, both tariffs) and is unaffected by Chat window paging.
- **Turn total** — `本轮 ¥x.xxxx` in each turn's action row, next to the token-usage pill, for that turn only.
- **Breakdown dialog** — same look as the shipped token-usage dialog (anchored above the trigger, `dl` rows, outside-click / Escape to dismiss): model, tariff (peak / off-peak), unit prices, and token counts plus money for input (cache miss), cache read, and output.
- Four decimal places.

## Install

> This plugin is **not published to npm** — install it straight from GitHub.

### Direct install (recommended)

```
plugin_manager install_bundle target=github:liandy0731/dsh-llm-cost
```

Refresh the page afterwards (the client half is loaded by the page).

### From source

```bash
git clone https://github.com/liandy0731/dsh-llm-cost.git
```

Then in DSH:

```
plugin_manager install_bundle target=<absolute path to the checkout>
```

Refresh the page. Host-half changes need a DSH restart to re-import the module.

## Prices

Prices live in `PRICES` at the top of `client.js`: CNY per 1,000,000 tokens, keyed by model id or by full `provider/model` route, each with a `peak` and an `offPeak` tier:

```js
const deepseekFlash = {
  peak:    { input: 2,   cacheRead: 0.04, cacheWrite: 2,   output: 8 },
  offPeak: { input: 1,   cacheRead: 0.02, cacheWrite: 1,   output: 4 },
};
```

- `input` = cache-miss input, `cacheRead` = cache-hit input, `cacheWrite` = cache write, `output` = output (reasoning included).
- Unknown models fall back to DeepSeek-Flash; ids ending in `-free` or routes starting with `opencode/` are priced at 0.

Built-in prices (official, October 2026):

| Model | Peak input/hit/output | Off-peak input/hit/output |
| --- | --- | --- |
| deepseek-flash | 2 / 0.04 / 8 | 1 / 0.02 / 4 |
| deepseek-v4-pro | 9 / 0.3 / 27 | 4.5 / 0.15 / 13.5 |
| glm-5.3 | 8 / 2 / 28 | same (no time tiers) |
| glm-5.3-flash | 0.8 / 0.23 / 2.8 | same |

Sources: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing), [Zhipu pricing](https://docs.bigmodel.cn/cn/guide/start/pricing).

Edit `PRICES`, save `client.js`, refresh the page.

## Peak / off-peak

Following DeepSeek's rule: Beijing time **Mon–Fri 09:00–12:00 and 14:00–18:00** is peak; everything else (weekends, statutory holidays all day) is off-peak at half price.

The statutory-holiday table comes from the State Council notice published every November (2026 is built in — 33 days). Models without time tiers simply use the same numbers for both.

## Limits

- A local estimate, not a bill. Sync `PRICES` when official prices change.
- Subagents run in their own sessions and are not counted.
- The holiday table needs a yearly update.
- Token-based only: per-request charges (image/file upload, Search, Fetch) are not included.

## How it works

- The host half registers the `llmCostTokens` session projection: it folds the whole durable log into per-route token buckets split by peak / off-peak, so the client gets an exact whole-session split regardless of Chat paging.
- The client half contributes two read-only slots: `conversation.composer.dock` (session total) and `conversation.chat.assistant-actions` (turn total, attached to the finalized assistant message's action row so it sits beside the token-usage pill; the amount comes from the Chat layer's `TurnTokenUsage`).
- No DSH core changes, no session writes, no model-request subscriptions.

## License

MIT
