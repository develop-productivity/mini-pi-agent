# mini-pi-agent 开发进度

## 当前状态：工具边界已闭环，Agent 双层循环尚未实现

`npm run typecheck` 已清零，`npm run smoke` 通过包内测试和跨包测试。Agent 目前可以接收工具并暴露事件订阅，但 `prompt()` 还没有进入模型调用与工具执行循环。

### 已完成

| 模块 | 状态 | 说明 |
|---|---|---|
| monorepo 和依赖方向 | 完成 | `coding-agent → agent → ai`，跨包只用包名 |
| `@mini-pi/ai` 类型和 provider | 基本完成 | 统一 `toolCalls/toolCallId`；mock 在 `src`；OpenAI translator 支持 stopReason、usage 和 abort |
| `@mini-pi/agent` 工具抽象 | 完成 | `ToolSpec`、`AgentTool`、`ToolContext`、`defineTool` |
| `@mini-pi/agent` registry/executor | 完成 | 实例级 `ToolRegistry`；执行前校验参数，失败转文本 |
| `@mini-pi/agent` 事件总线 | 基础完成 | 支持消息和工具生命周期事件、取消订阅、监听器错误隔离 |
| `@mini-pi/coding-agent` 内置工具 | 完成 | read/write/edit/bash/current_time，由工厂按 cwd 创建 |
| `@mini-pi/coding-agent` sandbox | 基础完成 | 路径约束，以及 bash 超时、输出上限和进程树终止 |
| `@mini-pi/coding-agent` session/MCP | 代码已迁移 | 已纳入 typecheck，尚未接入 Agent 和 CLI |
| 包内与跨包 smoke | 完成 | ai、agent、coding-agent 各自 smoke，根级验证三包协作 |

### 下一步

1. 实现 `Agent.prompt()`：模型调用 → tool calls → executor → tool result 回填 → 再次调用模型。
2. 实现 turn/steering/follow-up/abort 的状态管理，并广播完整事件序列。
3. 新建 CLI 宿主，让 Agent 只通过事件通知 Host，不反向依赖 UI。
4. 将 session 接入 Agent，验证 JSONL 恢复和 context 构建。
5. 实现流式输出和上下文压缩。
6. 实现 hooks、权限弹窗和 MCP/Skill 工具注册。
7. 完整 Agent loop 跑通后，删除 CI typecheck 的 `continue-on-error`。

### 验证基线

```text
npm run typecheck  → 0 errors
npm run smoke      → agent smoke ok
                     ai smoke ok
                     coding-agent smoke ok
                     cross-package smoke ok
```

### 目标

`PROVIDER=mock` 时，CLI 能完成一次“请求工具 → 执行 → 结果回填 → 最终回复”，并能从事件流观察完整的 agent/turn/message/tool 生命周期。
