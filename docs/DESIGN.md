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
│  provider/  tools/  session/  hooks/  plugins/(mcp + skills)      │
│  工具注册 · 多模型适配 · 会话持久化 · 上下文压缩 · 生命周期钩子      │
└────────────────┬─────────────────────────────────────────────────┘
                 │  执行前拦截
┌────────────────▼─────────────────────────────────────────────────┐
│  sandbox（执行沙箱）                                               │
│  路径约束 · bash 超时/输出上限 · 权限引擎（allow/deny/ask）          │
└──────────────────────────────────────────────────────────────────┘
```

## agent_demo 功能 → 三层映射

| 文件 | 层 | 说明 |
|---|---|---|
| `core/agent.ts` | **loop** | 主循环、turn 管理、abort、steering/follow-up 队列、事件 emit |
| `core/events.ts` | **loop** | AgentEvent 判别联合 + 事件总线 |
| `core/bind-ui-events.ts` | **loop→host** | 事件 → UI 桥接（宿主零侵入观察） |
| `core/metrics.ts` | **loop 旁路** | 事件总线的订阅者，统计 token/工具/成功率 |
| `providers/types.ts` | **runtime** | 中间格式 Message/Tool/CompletionRequest/Response + Api 接口 |
| `providers/factory.ts` | **runtime** | 按 PROVIDER 环境变量创建对应 Api |
| `providers/anthropic.ts` | **runtime** | Anthropic translator + SSE 流式 |
| `providers/openai.ts` | **runtime** | OpenAI/OpenRouter/DeepSeek translator |
| `providers/mock.ts` | **runtime** | 离线确定性 mock，无需 key |
| `providers/sse.ts` | **runtime** | 手写 SSE 解析（字节→事件） |
| `providers/retry.ts` | **runtime** | 429/5xx 分类重试 + 指数退避 |
| `tools/tools.ts` | **runtime** | Tool 接口 + defineTool 工厂 + 参数校验 + 注册表 |
| `tools/executor.ts` | **runtime** | 统一执行入口，失败转文本 |
| `tools/agent-tools.ts` | **runtime** | subagent（把 agent loop 包成一个 tool） |
| `session/types.ts` | **runtime** | SessionEntry / CompactionEntry 类型 |
| `session/storage.ts` | **runtime** | append-only JSONL，entries 是真理 |
| `session/build.ts` | **runtime** | 从 entries 派生 messages（含 compaction 摘要） |
| `compaction/compact.ts` | **runtime** | 超限时摘要压缩，append marker 不删历史 |
| `hooks/types.ts` | **runtime** | 4 个生命周期点的 ctx 定义 |
| `hooks/registry.ts` | **runtime** | hook 注册 + matcher 匹配 + run() |
| `hooks/builtin.ts` | **runtime** | cwd 注入、skill 列表注入、权限拦截、日志 |
| `mcp/types.ts` | **runtime→plugin** | MCP JSON-RPC 类型 |
| `mcp/client.ts` | **runtime→plugin** | stdio JSON-RPC 客户端 |
| `mcp/adapter.ts` | **runtime→plugin** | MCP tool → 内部 Tool 适配 |
| `mcp/loader.ts` | **runtime→plugin** | 从 .mcp.json 加载 MCP server 配置 |
| `skills.ts` | **runtime→plugin** | Markdown 能力包加载 + read_skill tool |
| `permissions/engine.ts` | **sandbox** | allow/deny/ask 三档决策引擎 |
| `permissions/loader.ts` | **sandbox** | 从 JSON 加载权限规则 |
| `permissions/prompt.ts` | **sandbox→host** | 权限交互交给宿主实现 |
| `utils.ts`（assertInSandbox） | **sandbox** | 路径约束，防止路径逃逸 |
| `utils.ts`（runBash） | **sandbox** | bash 执行：超时、输出上限、abort、流式进度 |
| `agent.ts` | **host** | CLI 组合入口（readline） |
| `agent_tui.ts` | **host** | TUI 组合入口 |
| `agent_web.ts` | **host** | Web 组合入口（mini-pi 不做） |
| `tui.ts` | **host** | 全屏终端 UI（raw mode + ANSI） |
| `web/` | **host** | Web 服务器 + 会话隔离（mini-pi 不做） |

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

### 各层精简对照

#### agent_loop（~120 行）

| agent_demo | mini-pi | 精简了什么 |
|---|---|---|
| `core/agent.ts` (250行) | `core/agent.ts` (~120行) | 去掉 metrics 绑定、去掉复杂的双队列 class |
| `core/events.ts` (60行) | `core/events.ts` (~40行) | 保留事件类型 + bus，去掉 listener try/catch 可简化 |
| `core/bind-ui-events.ts` | 合并进各宿主文件 | 宿主直接 subscribe，不需要单独桥接文件 |
| `core/metrics.ts` | 不做 | — |

保留的核心：
- 两层 while 循环（inner: tool_call, outer: turn + steering）
- AbortController 中止当前 turn
- steering / follow-up 两个队列
- 事件总线 emit agent_start/end, turn_*, message_*, tool_execution_*

#### agent_runtime（~400 行，拆成 4 个子模块）

| agent_demo | mini-pi | 精简了什么 |
|---|---|---|
| `providers/` (6文件) | `provider/` (3文件) | 只保留 OpenAI 兼容 + mock，不做 Anthropic 原生格式 |
| `providers/retry.ts` | 不做 | 重试逻辑放到 provider 内部 |
| `providers/sse.ts` | 不做 | 先用非流式 complete()，TUI 需要时再加 |
| `tools/` (3文件) | `tools/` (3文件) | 保留注册表 + executor + 内置工具 |
| `tools/agent-tools.ts` | 不做 | subagent 第一版不做 |
| `session/` (3文件) | `session/` (1文件) | storage + buildContext 合并 |
| `compaction/compact.ts` | 不做 | 第一版不做上下文压缩 |
| `hooks/` (3文件) | `hooks/` (1文件) | 简化：只有 pre/post tool + session start |
| `mcp/` (5文件) | `plugins/mcp.ts` (1文件) | 合并 client + adapter + loader |
| `skills.ts` | `plugins/skills.ts` (1文件) | 保留 |

保留的核心：
- Tool 接口：`name + description + parameters(TSchema) + execute(args, ctx) → string`
- 注册表：`registerTool()` + `toolsByName` + 参数校验（typebox Compile/Check）
- Provider：`createApi()` → `{ complete(req): Promise<CompletionResponse> }`
- Session：append-only JSONL，`appendMessage()` + `getEntries()` + `buildContext()`
- Hooks：`register(kind, matcher, hook)` + `run(kind, ctx, toolName?)`
- MCP：stdio JSON-RPC，外部 server 的 tool 注册为本地 Tool
- Skills：从 skills/ 目录加载 .md，元数据注入 system prompt

#### sandbox（~100 行）

| agent_demo | mini-pi | 精简了什么 |
|---|---|---|
| `utils.ts` assertInSandbox | `sandbox/path.ts` | 独立成文件 |
| `utils.ts` runBash | `sandbox/bash.ts` | 独立成文件，保留超时/上限/abort |
| `permissions/` (3文件) | `sandbox/permissions.ts` (1文件) | engine + loader + prompt 合并 |

保留的核心：
- 路径约束：所有文件操作限定在 SANDBOX_ROOT 下
- bash 执行：超时、输出上限、进程树 kill、abort signal
- 权限引擎：allow/deny/ask 三档 + argPattern 正则匹配 + session 内存

#### Host（~200 行）

| agent_demo | mini-pi | 精简了什么 |
|---|---|---|
| `agent.ts` (60行) | `agent_cli.ts` (~50行) | 去掉 MCP 加载日志、简化 |
| `agent_tui.ts` (60行) | `agent_tui.ts` (~50行) | 同上 |
| `tui.ts` (400行) | `tui.ts` (~150行) | 去掉鼠标滚轮、去掉权限弹窗的复杂交互 |
| `web/` (5文件) | 不做 | — |

保留的核心：
- CLI：readline + AgentUi 接口 + 权限 prompter
- TUI：raw mode + ANSI 渲染 + steering/follow-up 模式 + spinner

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

按依赖从底向上：

1. `provider/types.ts` — Message/Tool/CompletionRequest/Response 类型定义
2. `provider/openai.ts` — OpenAI 兼容 translator（DeepSeek）
3. `provider/factory.ts` — createApi()
4. `sandbox/path.ts` — 路径约束
5. `sandbox/bash.ts` — 带安全约束的 bash
6. `sandbox/permissions.ts` — 权限引擎
7. `tools/registry.ts` — Tool 接口 + 注册表 + 参数校验
8. `tools/builtin.ts` — bash/read_file/write_file/edit_file
9. `tools/executor.ts` — 统一执行入口
10. `session/storage.ts` — JSONL 存储 + buildContext
11. `hooks/registry.ts` — 简化版 hooks
12. `core/events.ts` — 事件总线
13. `core/agent.ts` — 主循环
14. `agent_cli.ts` — CLI 宿主
15. `tui.ts` + `agent_tui.ts` — TUI 宿主
16. `plugins/mcp.ts` — MCP 插件（可选）
17. `plugins/skills.ts` — Skills 插件（可选）

### 保留 vs 砍掉

| 保留 | 砍掉 | 理由 |
|---|---|---|
| agent_loop 两层循环 | metrics 统计 | mini-pi 不需要 token 计数 |
| 事件总线 | web 宿主 | 只做 CLI + TUI |
| steering/follow-up | 会话隔离/配额 | 单用户单会话 |
| abort | session manager | 不做多会话 |
| Tool 注册表 + 参数校验 | subagent | 第一版不做嵌套 agent |
| 权限引擎 | retry + 退避 | 放到 provider 内部简化 |
| MCP 插件 | SSE 流式 | 先用非流式，需要时再加 |
| Skills 插件 | compaction | 短会话不需要压缩 |
| append-only JSONL | | |
| 路径约束 + bash 约束 | | |
