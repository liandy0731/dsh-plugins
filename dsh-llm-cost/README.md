# dsh-llm-cost

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的**费用计**：在输入框下方显示本次会话的累计花费，在每轮操作行里（token 用量旁边）显示该轮花费，点一下弹出明细。

数字按各模型**官网公开单价 × token 数**本地估算，不是账单。

## 功能

- **累计**：输入框下方原有统计行末尾新增一个「累计 ¥x.xxxx」，覆盖整个会话（跨轮次、跨模型、跨高峰/空闲时段），长会话翻页也不漏算。
- **本轮**：每轮对话操作行里、紧跟「用量 xxx tok」之后（时间之前）新增「本轮 ¥x.xxxx」，只算这一轮。
- **明细弹窗**：与 token 用量弹窗同一套观感——贴着触发点向上弹出、`dl` 明细行、点外面或 Esc 关闭。内容包含模型、时段（高峰/空闲）、该时段单价、输入（未命中）/ 缓存命中 / 输出 各自的 token 数 + 金额、合计。
- 金额保留 4 位小数。

## 安装

> 这个插件**没有发布到 npm**，请直接从 GitHub 安装。

### 直接装（推荐）

在 DSH 中让智能体执行：

```
plugin_manager install_bundle target=github:liandy0731/dsh-llm-cost
```

安装后**刷新页面**（客户端半边由页面加载）。

### 从源码

```bash
git clone https://github.com/liandy0731/dsh-llm-cost.git
```

然后在 DSH 中：

```
plugin_manager install_bundle target=<仓库目录的绝对路径>
```

安装后刷新页面。宿主半边改动需要重启 DSH 才会重新导入模块。

## 单价表

单价写在 `client.js` 顶部的 `PRICES`：元 / 百万 token，按模型 id（或 `provider/model` 完整路由）索引，每项含 `peak`（高峰）与 `offPeak`（空闲）两档：

```js
const deepseekFlash = {
  peak:    { input: 2,   cacheRead: 0.04, cacheWrite: 2,   output: 8 },
  offPeak: { input: 1,   cacheRead: 0.02, cacheWrite: 1,   output: 4 },
};
```

- `input` 缓存未命中输入，`cacheRead` 缓存命中输入，`cacheWrite` 缓存写入，`output` 输出（含推理 token）。
- 未在表里的模型按 DeepSeek-Flash 估算；带 `-free` 后缀或走 `opencode/` 路由的模型按 0 计。

内置（2026-10 官网价）：

| 模型 | 高峰 输入/命中/输出 | 空闲 输入/命中/输出 |
| --- | --- | --- |
| deepseek-flash | 2 / 0.04 / 8 | 1 / 0.02 / 4 |
| deepseek-v4-pro | 9 / 0.3 / 27 | 4.5 / 0.15 / 13.5 |
| glm-5.3 | 8 / 2 / 28 | 同左（无分时） |
| glm-5.3-flash | 0.8 / 0.23 / 2.8 | 同左 |

来源：[DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[智谱定价](https://docs.bigmodel.cn/cn/guide/start/pricing)。

改完单价保存 `client.js`，刷新页面即可生效。

## 高峰 / 空闲

按 DeepSeek 的规则：北京时间**周一至周五 09:00–12:00、14:00–18:00** 为高峰，其余时段（含周末、法定节假日全天）为空闲，空闲价是高峰价的一半。

法定节假日表来自国务院办公厅每年 11 月发布的《部分节假日安排的通知》（当前内置 2026 年，共 33 天），每年更新一次；其他模型没有分时价的，两档填同一个数即可。

## 口径与已知限制

- 是**本地估算**，不是账单；官网调价后需要同步改一次 `PRICES`。
- 子代理在独立会话里运行，不计入当前会话的累计。
- 节假日表每年需要手动更新一次（文件内有出处与年份注释）。
- 计费口径只认 token：图片/文件上传、Search、Fetch 等按次计费的项目没有折算。

## 实现

- 宿主半边注册一个会话投影 `llmCostTokens`：按 `provider/model` 路由把整条日志的 token 折成「高峰 / 空闲」两组桶，客户端因此能拿到整个会话的精确拆分，不受聊天窗口分页影响。
- 客户端半边是两个只读 slot 贡献：`conversation.composer.dock`（累计）与 `conversation.chat.assistant-actions`（本轮，挂在最终 assistant 消息的操作行里，所以和 token 用量并列）；本轮金额取自 Chat 层已有的 `TurnTokenUsage`。
- 不修改 DSH 本体，不写会话日志，不订阅模型请求。

## 开发

```
# 客户端改动：保存后刷新页面
# 宿主改动：需要重新导入模块（移除再安装该 bundle，或重启 DSH）
```

## License

MIT
