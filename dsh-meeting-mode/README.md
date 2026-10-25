# dsh-meeting-mode 会议模式

DSH 面板插件：开会时打开「会议模式」，一键开始实时转写；会后一键生成会议纪要与脑图，下载后发给参会方。

## 功能

- **实时转写**：浏览器麦克风 → 16k PCM → DSH Host → 阿里云百炼 `qwen-audio-3.1-asr-flash-streaming`（官方当前主推的会议持续转写模型，run-task WebSocket 协议），面板实时滚动显示识别结果
- **会后纪要**：转写全文交给凭据库里的 `DEEPSEEK_API_KEY`（`deepseek-chat`），生成摘要 / 讨论要点 / 决议 / 待办
- **脑图**：markmap 交互式 HTML（可展开折叠，浏览器直接打开，可打印成 PDF）
- **落盘文件**：`转写全文.txt`、`会议纪要.md`、`会议纪要.docx`、`脑图.html`、`meta.json`
- **历史会议**：面板内可回看并补生成纪要（宿主重启后依然可用）

## 使用

1. 左侧栏点「会议模式」→ 输入会议标题 → 点「开始会议」（首次需允许麦克风权限）
2. 正常开会，面板实时显示转写
3. 点「结束会议」→ 点「生成会议纪要」→ 等待 10-40 秒
4. 下载 Word 纪要 / 脑图 HTML，发给参会方

## 配置（cordis.patch.yml）

| 字段 | 默认 | 说明 |
|---|---|---|
| `keyFile` | `D:/DSH/插件/ec-img/key.txt` | 百炼 API Key 文件（第一行有效），用于实时转写；优先级低于 `apiKey` |
| `apiKey` | 空 | 直接填百炼 API Key（`sk-` 开头） |
| `asrModel` | `qwen-audio-3.1-asr-flash-streaming` | 实时转写模型（`paraformer-realtime-v2`/`fun-asr-realtime` 需账户开通且无欠费） |
| `asrEndpoint` | `wss://dashscope.aliyuncs.com/api-ws/v1/inference` | 转写 WebSocket 端点 |
| `llmModel` | `deepseek-chat` | 纪要生成模型 |
| `llmBaseUrl` | `https://api.deepseek.com` | OpenAI 兼容端点 |
| `llmKeyRef` | `DEEPSEEK_API_KEY` | 纪要生成 Key 的凭据引用（DSH 凭据库） |
| `llmApiKey` | 空 | 直接填纪要生成 Key（优先级最高） |
| `outputDir` | `D:/DSH/本地会议/meetings` | 会议记录输出目录 |
| `languageHints` | `zh,en` | 识别语言 |
| `sampleRate` | `16000` | 音频采样率 |

## 费用参考（2026-10 北京地域）

- 实时转写（qwen-audio-3.1-asr-flash-streaming）：token 计费，输入 6 / 输出 4.5 元每百万 token，1 小时会议约 0.5~1 元；新账号通常有各模型 100 万 token 免费额度
- 纪要生成（deepseek-chat）：约 2 元每百万输入 token，1 小时会议通常 < 0.1 元
- 注：`paraformer-realtime-v2`（0.86 元/小时）更便宜但要求账户无欠费且开通对应模型；本机默认选了当前账户可直接调用的 qwen-audio 流式模型

## 已知边界（v0.1）

- 不区分说话人（说话人分离需要录音文件走离线转写，后续版本考虑）
- 仅支持麦克风收音；线上会议对方声音需外放或后续增加系统内录
- 脑图 HTML 需联网加载 markmap 渲染脚本（cdn.jsdelivr.net）
- `/meeting-mode-api` 路由仅本机回环可用，无鉴权（与 GUI 同信任级别），请勿将端口暴露到局域网
