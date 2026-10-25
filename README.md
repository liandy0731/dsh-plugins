# dsh-plugins

DeepSeek Harness（DSH）自研插件合集：一个仓库，多个插件文件夹，每个文件夹是一个独立完整的插件包（含自己的 package.json / LICENSE / CHANGELOG）。

## 插件列表

| 插件 | 文件夹 | 版本 | 功能 |
|---|---|---|---|
| dsh-meeting-mode | [dsh-meeting-mode/](./dsh-meeting-mode) | v0.1.1 | 会议模式面板：麦克风实时转写（阿里云百炼）+ 会后纪要（Markdown/Word）+ markmap 交互脑图 |
| dsh-parallel-sessions | [dsh-parallel-sessions/](./dsh-parallel-sessions) | v0.4.0 | 跨项目「会话状态」面板：按状态上色并标文字（待审批/待回答/计划待审/已完成未看/运行中/空闲） |
| dsh-llm-cost | [dsh-llm-cost/](./dsh-llm-cost) | v0.1.4 | LLM 成本计量：单轮与全会话 Token 花费统计面板 |

## 安装（从本仓库安装单个插件）

DSH 插件管理支持从 monorepo 子目录安装（pnpm `#path:` 语法），在安装框输入对应 spec 即可：

```
github:liandy0731/dsh-plugins#path:dsh-meeting-mode
github:liandy0731/dsh-plugins#path:dsh-parallel-sessions
github:liandy0731/dsh-plugins#path:dsh-llm-cost
```

## 开发与同步

各插件的历史提交已通过 `git subtree` 完整保留在本仓库对应文件夹下。插件在原独立仓库继续开发时，可随时把最新改动同步进来：

```bash
git subtree pull --prefix=dsh-llm-cost https://github.com/liandy0731/dsh-llm-cost.git main
git subtree pull --prefix=dsh-parallel-sessions https://github.com/liandy0731/dsh-parallel-sessions.git main
git subtree pull --prefix=dsh-meeting-mode https://github.com/liandy0731/dsh-meeting-mode.git main
```

## License

MIT —— 各插件文件夹内附独立 LICENSE。
