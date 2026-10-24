# mini-pi-agent 架构设计

## 三层架构

```
┌──────────────────────────────────────────────────────────────────┐
│  Host（宿主）                                                      │
│  cli.ts  ·  tui.ts                                                │
│  只做 I/O：读键盘、写屏幕、权限交互                                  │
└────────────────┬─────────────────────────────────────────────────┘
                 │  AgentEventBus（事件订阅）
┌────────────────▼─────────────────────────────────────────────────┐
│  agent_loop（智能体执行循环）                                       │
│  core/agent.ts  ·  core/events.ts                                  │
│  while 循环：callLLM → 有工具就执行 → 喂回去 → 没有就停             │
│  steering / follow-up / abort / turn 管理                           │
└────────────────┬─────────────────────────────────────────────────┘
                 │  Tool 接口（一切皆插件）
┌────────────────▼─────────────────────────────────────────────────┐
│  agent_runtime（智能体运行时）                                      │
│  packages/ai（模型接入）· tools/ session/ hooks/ plugins/          │
│  工具注册 · 多模型适配 · 流式输出 · 会话持久化 · 上下文压缩 · 钩子  │
└────────────────┬─────────────────────────────────────────────────┘
                 │  执行前拦截
┌────────────────▼─────────────────────────────────────────────────┐
│  sandbox（执行沙箱）                                               │
│  路径约束 · bash 超时/输出上限 · 权限引擎（allow/deny/ask）          │
└──────────────────────────────────────────────────────────────────┘
```

## mini-pi 精简方案

### 目标

在 mini-pi-agent 中实现一个**可运行的编程智能体**，核心理念是
"一切皆插件"，但模块尽量精简——不做 web，不做 metrics，不做会话配额。

### 精简原则

1. **agent_loop 不依赖 runtime 的具体实现**——只认 Tool 接口和 event bus
2. **runtime 是可插拔的**——provider、tools、hooks、session 都是接口，可以换
3. **sandbox 是 runtime 的执行守卫**——工具执行前过一遍权限检查
4. **只做 CLI + TUI 两个宿主**——共享同一个 Agent 内核
5. **每个模块尽量一个文件**——不超过 200 行

### 项目结构

npm workspaces monorepo，依赖只能往下：`coding-agent → agent → ai`。

```
mini-pi-agent/
├── packages/
│   ├── ai/src/                   # @mini-pi/ai —— 模型接入（runtime 的 provider 部分）
│   │   ├── types.ts              # Message / Tool / CompletionRequest / Response
│   │   ├── factory.ts            # createApi() 按 env 选 provider
│   │   ├── openai.ts             # OpenAI 兼容 translator（DeepSeek/OpenRouter）
│   │   └── mock.ts               # 离线确定性 mock
│   ├── agent/src/                # @mini-pi/agent —— agent_loop
│   │   ├── core/agent.ts         # while 循环 + turn + abort + steering
│   │   ├── core/events.ts        # AgentEvent + EventBus
│   │   ├── tools/registry.ts     # Tool 接口 + 注册表 + defineTool + 参数校验
│   │   │                         #（内置工具暂时也在这里，写 sandbox 时挪到 coding-agent）
│   │   └── tools/executor.ts     # 统一执行入口（失败转文本）
│   └── coding-agent/src/         # @mini-pi/coding-agent —— 待建
│       ├── host/cli.ts           # CLI 宿主（readline）
│       ├── host/tui.ts           # TUI 宿主（raw mode terminal）
│       ├── tools/builtin.ts      # bash / read_file / write_file / edit_file
│       ├── session/storage.ts    # append-only JSONL + buildContext
│       ├── hooks/registry.ts     # 简化版：pre/post tool + session start
│       ├── sandbox/              # path.ts / bash.ts / permissions.ts
│       └── plugins/              # mcp.ts / skills.ts（可选）
├── demo/                         # 单文件 demo，不依赖任何包
├── scripts/smoke.ts              # 冒烟测试
├── .mcp.json / .permission.json  # 可选配置
├── .env.example
├── package.json                  # workspaces
└── tsconfig.json
```

### 各层要点

#### agent_loop（~120 行）

保留的核心：
- 两层 while 循环（inner: tool_call, outer: turn + steering）
- AbortController 中止当前 turn
- steering / follow-up 两个队列
- 事件总线 emit agent_start/end, turn_*, message_*, tool_execution_*

#### agent_runtime（~400 行，拆成 4 个子模块）

保留的核心：
- Tool 接口：`name + description + parameters(TSchema) + execute(args, ctx) → string`
- 注册表：`registerTool()` + `toolsByName` + 参数校验（typebox Compile/Check）
- Provider：`createApi()` → `{ complete(req): Promise<CompletionResponse> }`；流式 `stream(req)` 未实现
- 上下文压缩（未实现）：超限时调用不带 tools 的 `complete()` 生成摘要，append 一条 marker，历史不删
- Session：append-only JSONL，`appendMessage()` + `getEntries()` + `buildContext()`
- Hooks：`register(kind, matcher, hook)` + `run(kind, ctx, toolName?)`
- MCP：stdio JSON-RPC，外部 server 的 tool 注册为本地 Tool
- Skills：从 skills/ 目录加载 .md，元数据注入 system prompt

#### sandbox（~100 行）

保留的核心：
- 路径约束：所有文件操作限定在 SANDBOX_ROOT 下
- bash 执行：超时、输出上限、进程树 kill、abort signal
- 权限引擎：allow/deny/ask 三档 + argPattern 正则匹配 + session 内存

#### Host（~200 行）

保留的核心：
- CLI：readline + AgentUi 接口 + 权限 prompter
- TUI：raw mode + ANSI 渲染 + steering/follow-up 模式 + spinner + 鼠标滚轮翻看之前的内容 + 简单的权限弹窗

### "一切皆插件"在 mini-pi 中的体现

```
内置工具 (tools/builtin.ts)
    ├── bash        → sandbox/bash.ts（带安全约束）
    ├── read_file   → sandbox/path.ts（路径约束）
    ├── write_file  → sandbox/path.ts（路径约束）
    └── edit_file   → sandbox/path.ts（路径约束）

插件工具 (plugins/)
    ├── MCP server  → mcp.ts 加载 .mcp.json，每个 server 的 tool 注册为 Tool
    └── Skills      → skills.ts 加载 skills/*.md，read_skill 注册为 Tool

    ↓ 全部归一成同一个 Tool 接口 ↓

tools/registry.ts 注册表
    toolsByName["bash"] = { execute: ... }
    toolsByName["mcp__filesystem__read"] = { execute: ... }
    toolsByName["read_skill"] = { execute: ... }

    ↓ agent_loop 只认这个表 ↓

core/agent.ts
    for (const tc of response.message.toolCalls) {
        const result = await executeTool(tc.name, tc.arguments, signal)
    }
```

agent_loop 不知道、也不需要知道一个 tool 是内置的还是来自 MCP 的还是来自 skill 的。
它只调 `executeTool(name, args)`，注册表负责找到对应的 `Tool` 并执行。

### 实现顺序

按依赖从底向上（路径相对 `packages/`）：

1. `ai/src/types.ts` — Message/Tool/CompletionRequest/Response 类型定义
2. `ai/src/openai.ts` — OpenAI 兼容 translator（DeepSeek）
3. `ai/src/factory.ts` — createApi()
4. `coding-agent/src/sandbox/path.ts` — 路径约束
5. `coding-agent/src/sandbox/bash.ts` — 带安全约束的 bash
6. `coding-agent/src/sandbox/permissions.ts` — 权限引擎
7. `agent/src/tools/registry.ts` — Tool 接口 + 注册表 + 参数校验
8. `coding-agent/src/tools/builtin.ts` — bash/read_file/write_file/edit_file
9. `agent/src/tools/executor.ts` — 统一执行入口
10. `coding-agent/src/session/storage.ts` — JSONL 存储 + buildContext
11. `coding-agent/src/hooks/registry.ts` — 简化版 hooks
12. `agent/src/core/events.ts` — 事件总线
13. `agent/src/core/agent.ts` — 主循环
14. `coding-agent/src/host/cli.ts` — CLI 宿主
15. `coding-agent/src/host/tui.ts` — TUI 宿主
16. `coding-agent/src/plugins/mcp.ts` — MCP 插件（可选）
17. `coding-agent/src/plugins/skills.ts` — Skills 插件（可选）

### 保留 vs 砍掉

| 保留 | 砍掉 | 理由 |
|---|---|---|
| agent_loop 两层循环 | metrics 统计 | mini-pi 不需要 token 计数 |
| 事件总线 | web 宿主 | 只做 CLI + TUI |
| steering/follow-up | 会话隔离/配额 | 单用户单会话 |
| abort | session manager | 不做多会话 |
| Tool 注册表 + 参数校验 | subagent | 第一版不做嵌套 agent |
| 权限引擎 | retry + 退避 | 放到 provider 内部简化 |
| MCP 插件 | | |
| Skills 插件 | | |
| 流式输出（SSE，未实现） | | 先用非流式 complete() 跑通循环，再加 stream() |
| 上下文压缩（未实现） | | 超限时摘要，只 append 一条 marker，历史不删 |
| append-only JSONL | | |
| 路径约束 + bash 约束 | | |
| OpenAI 兼容格式 + mock | Anthropic 原生格式 | DeepSeek、OpenRouter 都走 OpenAI 兼容接口，一种 translator 就够 |
| TUI 鼠标滚轮翻看之前的内容 | | 长对话必须能往回翻 |
| 简单的权限弹窗（询问一次：允许 / 拒绝） | 复杂的权限弹窗交互 | 权限必须问用户，但不需要多级菜单 |
| session：storage + buildContext 一个文件 | session 拆多个文件 | 每个模块尽量一个文件 |
| MCP：client + adapter + loader 一个文件 | MCP 拆多个文件 | 同上 |
