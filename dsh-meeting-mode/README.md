# dsh-meeting-mode 会议模式

DSH 面板插件：开会时打开「会议模式」，一键开始实时转写；会后一键生成会议纪要与脑图，下载后发给参会方。

## 功能

- **实时转写**：浏览器麦克风 → 16k PCM → DSH Host → 阿里云百炼 `qwen-audio-3.1-asr-flash-streaming`（官方当前主推的会议持续转写模型，run-task WebSocket 协议），面板实时滚动显示识别结果
- **切走不中断**：收音是页面级单例，切换到其他会话/面板后转写继续，回到面板即见进度
- **状态标识**：侧栏图标圆点 + 行内文字胶囊 + 面板标题徽标 + 历史列表标签，覆盖 连接中 / 转写中 / 收尾中 / 异常 / 已结束（待出纪要）/ 已总结（待出脑图）/ 脑图已生成
- **会后纪要**：转写全文交给凭据库里的 `DEEPSEEK_API_KEY`（`deepseek-chat`），生成摘要 / 讨论要点 / 决议 / 待办；生成流程拆成「生成会议纪要」和「生成脑图」两步，各自可重做
- **脑图**：markmap 交互式 HTML（可展开折叠，浏览器直接打开，可打印成 PDF）；大纲随纪要一次生成，出图只做本地渲染
- **说话人分离（可选）**：录制时自动落盘 `音频.wav`；详情页一键「区分发言人」，离线 `paraformer-v2` + diarization 重跑整段录音，按时间戳把 `说话人1/说话人2` 回填到转写全文，重出纪要即带发言人
- **一键沉淀**：详情页可把纪要存进本地 WeKnora 知识库或 mneme 记忆（同名自动去重）；对应插件没装就显示「尚未安装」，不会报错
- **落盘文件**：`转写全文.txt`、`音频.wav`、`会议纪要.md`、`会议纪要.docx`、`脑图.html`、`meta.json`
- **历史会议**：面板内可回看并补生成纪要（宿主重启后依然可用）

## 使用

1. 左侧栏点「会议模式」→ 输入会议标题 → 点「开始会议」（首次需允许麦克风权限）
2. 正常开会，面板实时显示转写；切到别的会话也不会中断
3. 点「结束会议」→（可选）「区分发言人」→ 点「生成会议纪要」→ 点「生成脑图」
4. 下载 Word 纪要 / 脑图 HTML / 转写全文，发给参会方

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
| `diarizeModel` | `paraformer-v2` | 会后说话人分离用的离线识别模型 |
| `diarizeSpeakerCount` | `0` | 预期说话人数（2-100，仅提示值；0=让服务端自动判定） |
| `diarizeTimeoutMinutes` | `30` | 离线识别任务的轮询上限 |
| `weknoraBaseUrl` | 空 | 本地 WeKnora 地址（如 `http://localhost:8080/api/v1`）；留空则详情页显示未检测到知识库 |
| `weknoraApiKey` | 空 | WeKnora 的 `X-API-Key`（建议只配在本机 profile patch，不进包源码） |
| `weknoraKnowledgeBaseId` | 空 | 默认写入的知识库 id |

## 费用参考（2026-10 北京地域）

- 实时转写（qwen-audio-3.1-asr-flash-streaming）：token 计费，输入 6 / 输出 4.5 元每百万 token，1 小时会议约 0.5~1 元；新账号通常有各模型 100 万 token 免费额度
- 说话人分离（paraformer-v2 离线）：0.288 元/小时（0.00008 元/秒），说话人分离不单独计费；文件先传到百炼临时存储（48 小时有效）
- 纪要生成（deepseek-chat）：约 2 元每百万输入 token，1 小时会议通常 < 0.1 元
- 注：`paraformer-realtime-v2`（0.86 元/小时）更便宜但要求账户无欠费且开通对应模型；本机默认选了当前账户可直接调用的 qwen-audio 流式模型

## 已知边界（v0.3）

- 实时流式模型均不返回说话人，分离只能靠会后离线重跑（任务排队通常 1-5 分钟）；分离效果取决于真实录音质量，纯 TTS 合成音验证不出聚类差异
- 说话人对齐依赖句子毫秒时间戳；识别中途断线重连后，时间基准可能重置，那一段的说话人可能标错
- 仅支持麦克风收音；线上会议对方声音需外放或后续增加系统内录
- 脑图 HTML 需联网加载 markmap 渲染脚本（cdn.jsdelivr.net）
- `/meeting-mode-api` 路由仅本机回环可用，无鉴权（与 GUI 同信任级别），请勿将端口暴露到局域网
