# 工具边界迁移

2026-11-01 · AI 起草，用户拍板执行

## 要解决什么

当前 monorepo 的概念分层已经确定，但工具迁移还没有闭环：

- `mock` 实现被放进 `packages/ai/test/`，生产代码 `factory.ts` 反向 import 测试文件。
- `packages/coding-agent` 没有 `src/index.ts`，包入口不存在。
- session 仍 import 已删除的 `../providers/types.ts`。
- `agent` 只有 `ToolRegistry` 接口和参数校验，还没有可注入的 registry 与统一执行入口。
- 根 smoke 仍依赖旧的全局 `getTool()`，无法验证新边界。

目标是让依赖重新保持 `coding-agent → agent → ai`，并恢复离线 smoke 和类型检查基线。

## 考虑过的方案

| 方案 | 做法 | 取舍 |
|---|---|---|
| A. 继续使用全局工具表 | `agent` 维护模块级 `toolsByName` | 改动最少，但无法隔离不同 session，也要求 `agent` 知道具体工具 |
| B. 实例级 registry（选这个） | `coding-agent` 创建 `AgentTool[]`，Agent 接收工具并构造 registry；executor 通过 registry 执行 | 多一层注入，但内核不再依赖具体工具，测试可以完全离线 |
| C. 把 registry 也放进 `coding-agent` | coding-agent 同时管理工具和循环 | 会让 Agent 无法独立复用，违反三层依赖方向 |

## 设计

- `@mini-pi/ai` 保留模型协议和正式 mock provider；测试只测试公开实现，不承载生产实现。
- `@mini-pi/agent` 定义 `AgentTool`、`ToolContext`、`ToolRegistry`、`executeTool` 和工具生命周期事件。
- `@mini-pi/coding-agent` 定义具体的 read/write/edit/bash 工具以及 sandbox 辅助能力。
- `Agent` 接收工具列表或 registry，provider 只接收模型的 tool schema，不接收可执行函数。
- 跨包导入只使用包名；每个包的公开入口必须是 `src/index.ts`。

本次不实现 Agent 双层循环、流式输出、session 接入或沙箱增强，只闭合工具边界和迁移后的验证链路。

## 风险与回滚

- 风险：registry 改为实例级后，旧 smoke 需要重写。
- 风险：`Tool` / `AgentTool` 命名统一会触及多个 import。
- 回滚：改动集中在包入口、tools 和 smoke，可按本分支整体回退，不影响 demo。

## 怎么验证

1. `npm install` 成功，`@mini-pi/coding-agent` 出现 workspace 链接。
2. `npm run typecheck` 不再出现本次迁移引入的错误。
3. `npm run smoke` 离线通过，并验证 mock → registry/executor → 工具结果 → 第二次 mock 回复。
4. 检查 `agent/src` 不 import `node:fs`、`node:child_process`，也不 import 具体 builtin 工具。

## 自审结论

方案符合已有 monorepo 决定和依赖方向，可通过分支整体回滚，验证命令明确。工具执行逻辑属于审查触发项，完成后应进行独立审查。

## 用户的决定

- 用户要求按上述方向直接修复迁移问题。
