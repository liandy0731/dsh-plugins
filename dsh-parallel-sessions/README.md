# dsh-parallel-sessions（显示名：会话状态）

跨项目的「会话状态」面板：同时开着多个项目、多个对话时，切走之后还能一眼看到
每条会话现在是什么状态（在跑 / 完成了没看 / 等你审批或回答），点一下直接切回去。

## 它做什么

- 左侧栏新增「会话状态」入口。
- 中央面板按项目分组，列出所有项目的会话，并按状态上色：

| 颜色 | 状态 | 含义 |
|---|---|---|
| 红 | 待审批 | 等你批准一次工具调用 |
| 橙 | 待回答 | Agent 问了问题，等你补充信息 |
| 紫 | 计划待审 | 计划模式停在审核步骤 |
| 蓝 | 已完成未看 | 跑完了但这条会话你还没点开 |
| 绿（脉冲） | 运行中 | 正在干活 |
| 灰 | 空闲 | 没有待处理事项 |

- 每行结构：**色点 + 状态文字 + 会话标题 + 最后活跃时间**；状态词始终显示（含「空闲」），不只依赖颜色。
- 排序：先按「该不该现在看」（待审批 → 待回答 → 计划待审 → 已完成未看 → 运行中 → 空闲），再按最后活跃时间；项目分组也按同样规则排序。
- 顶部显示「等你处理 N · 运行中 M · 共 T」，可勾选「只看需要我处理」。
- 以下内容不显示：空白会话、子代理会话、已归档会话。
- 点击任意一行直接打开该会话（`uiWorkspace.openSession`）。
- 每 30 秒自动刷新相对时间；数据本身来自客户端 Workspace / Session 快照，实时推送。

## 实现

Host 半边不注册任何东西，只让 Loader 认领 bundle、使 `dsh.client` 被扫描。
浏览器半边注册两个槽：

| 槽 | 作用 |
|---|---|
| `sidebar.panellist` (`id: parallel-sessions`) | 左侧栏图标 |
| `main` (`key: parallel-sessions`) | 对应的中央面板 |

数据来源（均为槽的标准 props）：

- `useWorkspaces` → `{ items: WorkspaceView[], archivedSessionIds, ... }`，`WorkspaceView.sessionIds` 给出每个项目的会话成员；
- `useSessions` → `{ ids, byId }`，摘要含 `displayTitle`、`updatedAt`、`running`、`blank`、`origin`、`cwd`；
- `useSessionStatus` → `Map<sessionId, { running, completionUnread, pendingInteraction?: { kind } }>`；`pendingInteraction.kind` 取 `approval` / `question` / `plan-review`，状态语义与 DSH 自带侧栏一致。

## 安装

从本地目录安装（开发时）：

```bash
# 在 DSH 会话里（需要 danger-full-access 权限）
plugin_manager action=install_bundle target="/path/to/dsh-parallel-sessions"
```

从 GitHub 安装：先 `git clone https://github.com/liandy0731/dsh-parallel-sessions.git`，
再用上面同一条 `install_bundle` 指向克隆下来的目录。

安装后侧栏出现「会话状态」图标；若没出现，刷新一次页面。

## 许可

MIT，见 [LICENSE](LICENSE)。
