# mini-pi-agent 开发进度

## 当前状态：三层骨架已搭好，最小循环尚未跑通

### 已完成

| 文件 | 层 | 状态 | 说明 |
|---|---|---|---|
| `packages/ai/src/types.ts` | runtime | 有类型定义 | Message/Tool/ToolCall/CompletionRequest/Response/Api 接口。`ToolCalls`/`ToolCallId` 用了 PascalCase，待统一为 camelCase |
| `packages/ai/src/openai.ts` | runtime | 有 translator | OpenAI 兼容格式双向翻译 + createOpenAiApi。引用 `parameter` 应为 `parameters` |
| `packages/ai/src/mock.ts` | runtime | 完成 | 离线确定性 mock，无需 key，支持 DEFAULT_SCRIPT + env 配置 |
| `packages/ai/src/factory.ts` | runtime | 完成 | CreateApi() 按 PROVIDER 环境变量选 mock/openai/openrouter/deepseek |
| `packages/agent/src/core/events.ts` | loop | 有 AgentEvent 类型 | `agentEventBus` 是空 interface，需改成 class（subscribe + emit） |
| `packages/agent/src/core/agent.ts` | loop | 有骨架 | PendingMessageQueue 完成；Agent 类骨架有了，但方法体空、eventBus 未初始化、subscribe 写法有误 |
| `packages/agent/src/tools/registry.ts` | runtime | 有 Tool 接口 + 注册表 + 校验 | defineTool/registerTool/getTool/validateArgs 都有；内置工具引用了未实现的 assertInSandbox/withLineNumbers/runBash；ToolContext 缺 onProgress |
| `packages/agent/src/tools/executor.ts` | runtime | 空文件 | 需要写 executeTool 统一执行入口 |

### 待完成（按顺序）

1. `types.ts` — `ToolCalls` -> `toolCalls`，`ToolCallId` -> `toolCallId`（4 处）
2. `openai.ts` — `parameter` -> `parameters`（1 处），修复后 TS 错误清零
3. `events.ts` — `agentEventBus` interface 改成 `AgentEventBus` class，实现 subscribe + emit
4. `executor.ts` — 写 executeTool：查注册表 -> 校验参数 -> 执行 -> 失败转文本
5. `registry.ts` — ToolContext 加 onProgress；内置工具暂时注释掉 assertInSandbox/withLineNumbers/runBash 依赖（或写 sandbox/）
6. `agent.ts` — 填入构造函数、prompt、steer、followUp、abort、subscribe、runAgent 两层 while 循环
7. CLI 宿主 — 新建 `packages/coding-agent`（package.json 参照 agent 包），写 `src/host/cli.ts`：readline + AgentUI + new Agent + 循环 prompt；根 package.json 加回 `cli` 脚本
8. `PROVIDER=mock` 跑通验证；之后删掉 `.github/workflows/ci.yml` 里 typecheck 的 `continue-on-error`

### 当前 TS 错误（13 个）

```
agent.ts:3 个   — ui/eventBus 未初始化，subscribe 写法有误
openai.ts:4 个  — toolCallId/toolCalls 大小写不匹配 + parameter 应为 parameters
registry.ts:6 个 — assertInSandbox/withLineNumbers/runBash 未定义 + onProgress 缺失
```

### 目标

跑通 `PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts`，在命令行中一问一答，mock 会先调 `get_current_time` 工具再给出最终回复，验证两层循环（inner: tool_call, outer: turn）。
