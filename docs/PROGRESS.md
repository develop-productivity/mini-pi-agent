# mini-pi-agent 开发进度

## 当前状态：Agent 双层循环和最小 CLI 已跑通，Session 尚未持久化

`npm run typecheck` 已清零，`npm run smoke` 通过包内测试和跨包测试。`Agent.prompt()` 通过注入的 `StreamFn` 跑完"模型调用 → 工具执行 → 结果回填 → 再次调用模型"，steering / follow-up 已接入，完整事件序列由 agent smoke 断言。

### 已完成

| 模块 | 状态 | 说明 |
|---|---|---|
| monorepo 和依赖方向 | 完成 | `coding-agent → agent → ai`，跨包只用包名 |
| `@mini-pi/ai` 类型和 provider | 基本完成 | 统一 `toolCalls/toolCallId`；mock 在 `src`；OpenAI translator 支持 stopReason、usage 和 abort；`stream()` 输出 `StreamEvent`（OpenAI SSE 和 mock 都已实现） |
| `@mini-pi/agent` 工具抽象 | 完成 | `ToolSpec`、`AgentTool`、`ToolContext`、`defineTool` |
| `@mini-pi/agent` registry/executor | 完成 | 实例级 `ToolRegistry`；执行前校验参数，失败转文本 |
| `@mini-pi/agent` 事件总线 | 基础完成 | 支持消息和工具生命周期事件、取消订阅、监听器错误隔离 |
| `@mini-pi/agent` agent loop | 基础完成 | `AgentLoopConfig`（model、streamFn、registry、steering/follow-up 回调）+ `AgentLoopContext`（历史拷贝、工具快照）；loop 只通过 `emit` 发事件 |
| `@mini-pi/agent` Agent 状态 | 基础完成 | `processEvents` 先根据事件更新 `state`（历史、流式消息、执行中的工具），再转发给监听器；历史只在 `message_end` 时追加 |
| `@mini-pi/coding-agent` 内置工具 | 完成 | read/write/edit/bash/current_time，由工厂按 cwd 创建 |
| `@mini-pi/coding-agent` sandbox | 基础完成 | 路径约束，以及 bash 超时、输出上限和进程树终止 |
| `@mini-pi/coding-agent` session/MCP | 代码已迁移 | 已纳入 typecheck，尚未接入 Agent 和 CLI |
| 包内与跨包 smoke | 完成 | ai、agent、coding-agent 各自 smoke，根级验证三包协作 |

### 下一步

1. ~~实现 `Agent.prompt()`：模型调用 → tool calls → executor → tool result 回填 → 再次调用模型。~~ 已完成。
2. turn/steering/follow-up 已完成并有测试。abort 还缺：中止后 loop 直接抛错、不发 `agent_end`，也没有测试；需要决定中止时是否写入一条带 `stopReason` 的 assistant 消息。
3. ~~新建 CLI 宿主~~ 最小 CLI 已完成：`packages/coding-agent/src/host/`（bootstrap / renderer / cli），`PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts` 跑通一整轮；根目录 `cli` 脚本由用户补回；Ctrl+C 中止还没验证（需要在真实终端里手动试）。
4. 将 session 接入 Agent，验证 JSONL 恢复和 context 构建。
5. Host 端流式渲染（loop 已发出 `message_update`），以及上下文压缩。
6. 实现 hooks、权限弹窗和 MCP/Skill 工具注册。
7. 完整 Agent loop 跑通后，删除 CI typecheck 的 `continue-on-error`。

### 下一阶段设计焦点

1. `AgentUI` 放在哪个包、由谁创建；Agent 不应反向依赖 Host。
2. 持有关系：Host 持有 `CodingAgentSession`；Session 工厂构造并私有持有 Agent，同时直接持有 SessionStorage；不引入独立 SessionManager。
3. `coding-agent` 核心类的职责：组合模型、工具、session、hooks、sandbox 和事件。
4. 借鉴 Pi 的抽象：低层 Agent、产品级 AgentSession、StreamFn、AgentTool、ResourceLoader。

设计草稿见 [Host、AgentUI 与 coding-agent 核心类](designs/2026-11-08-host-agent-ui-boundary.md)。

### 已知问题

- `CodingAgentSession.setModel()` 不生效：`Agent.state` 每次返回新对象，给它的 `model` 赋值改不到 `_state`。需要让 `state` 返回 `_state` 本身，或在 Agent 上提供修改入口。
- 模型流式输出过程中 abort 仍会抛错、事件不完整（审查第 2 条剩余部分）。

### 审查遗留

- 第 1、2、3、5 条必须修问题延期到下一次代码改动。
- 根 CLI/TUI 脚本由用户本人补回。
- 第 8–10 条建议仍待决定。

### 验证基线

```text
npm run typecheck  → 0 errors
npm run smoke      → agent smoke ok（含 Agent + mock stream 的事件序列、steering、follow-up）
                     ai smoke ok
                     coding-agent smoke ok
                     cross-package smoke ok
```

### 目标

`PROVIDER=mock` 时，CLI 能完成一次“请求工具 → 执行 → 结果回填 → 最终回复”，并能从事件流观察完整的 agent/turn/message/tool 生命周期。
