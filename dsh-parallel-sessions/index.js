/**
 * dsh-parallel-sessions —— Host 半边。
 *
 * 全部工作在浏览器侧（见 ./client.js）：注册左侧栏「会话状态」图标与对应的
 * 中央面板，数据直接读 DSH 客户端已有的 Workspace / Session 快照，不需要
 * Host 额外注册服务、工具或路由。
 *
 * Host 半边只需要作为一个合法的 cordis 插件被 Loader 认领，client-modules
 * 才会扫描到本包的 `dsh.client` 声明，并把 ./client 半边送进浏览器启动图。
 */

export const name = 'dsh-parallel-sessions'

/** 不依赖任何 Host 服务，缺失也不该阻止加载。 */
export const inject = []

export function apply(ctx) {
  ctx.logger?.info?.('dsh-parallel-sessions: host 半边已加载（UI 见浏览器侧的「会话状态」面板）')
}
