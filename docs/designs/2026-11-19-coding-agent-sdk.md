# coding-agent SDK 入口

2026-11-19 · AI 起草，用户确认方向；用户实现 factory / sdk，AI 完成 bootstrap 接入、导出和 smoke（2026-11-22）

## 要解决什么

现在创建一个可用的 `CodingAgentSession`，组装逻辑写在 `host/bootstrap.ts` 的 `createHostSession()` 里，和读环境变量的代码混在 Host 层：

- 只有 CLI（以后的 TUI）能用。想加 `--print`、RPC，或者让别的程序嵌入 mini-pi，就得复制一份组装代码。
- 组装过程中隐式读取环境变量：`createApi()` 自己读 `PROVIDER` 和各家的 key，调用方看不出、也控制不了 session 用的是哪个 provider。
- `@mini-pi/coding-agent` 的 `index.ts` 没有导出任何 runtime 相关的东西，包外拿不到 Session。

目标：参考 pi 的 `core/sdk.ts` 中的 `createAgentSession()`，提供**一个**对外的组装入口。它只接收显式的参数、不读环境变量；Host 只负责把环境变量和命令行转成参数。

## 考虑过的方案

| 方案 | 做法 | 取舍 |
|---|---|---|
| A. 保持现状 | 组装留在 `host/bootstrap.ts` | 不用改，但组装只能给 Host 用，环境变量的读取散在各处 |
| B. 新建 `core/sdk.ts`（照抄 pi 的目录） | 新建 `core/` 目录放 SDK | 名字和 pi 一致，但 mini-pi 的 `runtime/` 已经承担了 pi `core/` 的角色（`CodingAgentSession` 就在那里），两个目录职责重叠 |
| C. 新建 `runtime/sdk.ts`（选这个） | SDK 和 `CodingAgentSession` 放在一起，从包入口导出 | 不新增目录；和 DESIGN.md 里“runtime = 产品运行时”的说法一致 |

只学 pi 的模式，不照搬它的规模：pi 的 SDK 背后还有 services、runtime、ResourceLoader、SettingsManager 等多层。mini-pi 只需要一个函数、一个选项类型和一个结果类型。

## 设计

### 分层

```
host/cli.ts            readline 输入输出（对应 pi 的 modes/interactive）
host/bootstrap.ts      读环境变量和命令行 → CreateSessionOptions（对应 pi 的 main.ts）
  ↓ 调用
runtime/sdk.ts         createSession()：只做组装，不读 process.env（对应 pi 的 core/sdk.ts）
  ↓ 内部调用
runtime/coding-agent-session.ts
                       createCodingAgentSession()：底层工厂，不从包导出
```

### SDK 接口（`runtime/sdk.ts`）

```ts
export interface CreateSessionOptions {
    model: string;              // 必填：SDK 不替调用方选模型
    streamFn?: StreamFn;        // 与 api 二选一：直接给流式函数
    api?: ApiConfig;            // 与 streamFn 二选一：给 provider 配置，由 SDK 创建
    tools?: AgentTool[];        // 默认 createBuiltinTools({ cwd })
    cwd?: string;               // 默认 process.cwd()
    sessionPath: string;        // 必填：SDK 不决定文件写在哪
    onListenerError?: AgentListenerErrorHandler; // 实现时补充：原样交给 Agent，保留 CLI 原有的监听器报错输出
}

export interface CreateSessionResult {
    session: CodingAgentSession;
    // 预留：创建过程中的非致命诊断。参考 pi，SDK 不打印、不退出，交给调用方决定
}

export async function createSession(options: CreateSessionOptions): Promise<CreateSessionResult>;
```

规则：

- `streamFn` 和 `api` 都没给：抛错。不回退去读环境变量。
- 两个都给了：~~也抛错~~ **优先使用 `streamFn`，忽略 `api`**（用户实现时的决定，见末尾第 6 条）。
- 返回结果对象，而不是直接返回 Session，以后加诊断字段时不用改签名（同 pi）。

### `@mini-pi/ai`：`createApi()` 支持显式配置

```ts
export interface ApiConfig {
    provider: string;           // "mock" | "openai" | "openrouter" | "deepseek" | 其他 OpenAI 兼容
    baseURL?: string;           // 不填则用该 provider 的默认地址
    apiKey?: string;
    headers?: Record<string, string>;
}

export function apiConfigFromEnv(env?: NodeJS.ProcessEnv): ApiConfig;  // 把现在 createApi() 里读环境变量的逻辑搬到这里
export function createApi(config?: ApiConfig): Api;                     // 不传参数时 = createApi(apiConfigFromEnv())，保持现有行为
```

不传参数时行为不变，现有调用方（cross-package smoke、demo 以外的脚本）不受影响。

**例外：mock provider。** `createApi({ provider: "mock" })` 内部的 `createMockApi()` 仍会读 `MOCK_SCRIPT`、`MOCK_DELAY_MS`、`MOCK_CHUNK_SIZE`（离线测试用的开关）。它们只影响 mock 的脚本和节奏，不涉及真实 provider、地址或 key，所以不纳入“SDK 不读环境变量”的规则。本机设了 `MOCK_SCRIPT` 时，依赖默认脚本的 smoke 可能失败，跑 smoke 前应清掉这些变量。

约定（参考 pi 的 `env-api-keys.ts`，但不照搬回退规则）：

- provider 默认值用一张表描述（`baseURL`、`apiKeyEnv`、可选的 `baseURLEnv` 和默认请求头 `headers`），不用 switch 分支；openrouter 的 `HTTP-Referer` / `X-Title` 默认值放在表里，显式配置也会带上，`ApiConfig.headers` 同名覆盖，`OPENROUTER_HTTP_REFERER` / `OPENROUTER_APP_TITLE` 由 `apiConfigFromEnv` 转成覆盖项（第 1 轮审查第 6 条）；`mock` 不在表里；表里没有的 provider 沿用现在的行为，按 OpenAI 兼容处理并读 `OPENAI_*`。
- **只有 `apiConfigFromEnv(env)` 读环境变量**，`env` 可以注入，测试不碰真实的 `process.env`。
- `createApi(config)` 不读环境变量：`config` 缺 `baseURL` 时用表里的默认值；不是 mock 却缺 `apiKey` 时当场报错，报错信息写明对应的环境变量名。
- **显式配置缺 key 时不回退读环境变量**（pi 会回退）：规则只有一条，测试不受本机环境变量影响；想用环境变量的调用方先调用 `apiConfigFromEnv()`。

### Host（`host/bootstrap.ts`、`host/args.ts`）

- `resolveHostOptions(args, env, cwd)`：**只在这里解析一次** provider 配置（`apiConfigFromEnv(env)`），放进 `HostOptions.api`；显示用的 provider 和连接用的是同一份（第 1 轮审查第 7 条）。读取 `MODEL`，没设时 mock / deepseek 用默认模型，其他 provider 报错。
- **sessionPath 在这里决定**（参考 pi 的 `--session` / `--session-dir` / `PI_CODING_AGENT_SESSION_DIR`）：优先级 `--session <path>` > `--session-dir <dir>` > `$MINI_PI_SESSION_DIR` > `<cwd>/.sessions/<时间戳>.jsonl`。父目录由 `SessionStorage` 创建。SDK 只接收最终路径。
- `host/args.ts` 的 `parseHostArgs(argv)` 只认这两个参数，未知参数直接报错。
- `createHostSession(options)` 不读环境变量，直接调用 `createSession({ model, api, cwd, sessionPath, onListenerError })`。

### 包导出（`packages/coding-agent/src/index.ts`）

新增：`createSession`、`CreateSessionOptions`、`CreateSessionResult`，以及 `CodingAgentSession` 的类型。
不导出：`createCodingAgentSession`。对外只有一个入口，调用方不用纠结该用哪个。

### 不做

- 不加内存模式的 session（pi 有 `SessionManager.inMemory()`，这次不做）。
- 不拆 services / runtime 两层，也不做 ResourceLoader、SettingsManager。
- ~~不改 `CodingAgentSession` 的行为，持久化仍然没有接入。~~ 持久化已由 `persist and restore session` 提交接入；本设计不改它的行为，只给它补了 session smoke。
- 不改 CLI 的交互。

## 风险与回滚

- **改动了两个包的对外接口**：`@mini-pi/ai` 新增 `ApiConfig`、`apiConfigFromEnv`，`createApi` 改为可以传参（向后兼容）；`@mini-pi/coding-agent` 新增 SDK 导出。都是新增或兼容性修改，没有删除。
- **风险**：`createApi(config)` 和 `apiConfigFromEnv` 拆开后，各 provider 的默认 baseURL 可能和原来不一致。验证时对比四个 provider 拆分前后的配置。
- **风险**：`sessionPath` 必填会让 SDK 调用方多写一个参数。这是有意的：文件写在哪由调用方决定。
- **回滚**：改动集中在 `ai/src/factory.ts`、`coding-agent/src/runtime/sdk.ts`、`coding-agent/src/host/bootstrap.ts` 和两个 `index.ts`，还原对应提交即可；CLI 的用法不变。

## 怎么验证

1. `npm run typecheck`：0 个错误。
2. `npm run smoke` 通过，并新增一条 SDK smoke（放在 `packages/coding-agent/test/`）：
   - 用 mock 的 `streamFn` 加一个临时目录里的 `sessionPath` 调用 `createSession`，跑完“调用工具 → 结果回填 → 最终回复”；
   - 改用 `api: { provider: "mock" }` 再跑一次，结果相同；
   - `streamFn` 和 `api` 都不给时会抛错；~~两个都给时也会抛错~~ 两个都给时优先用 `streamFn`（决定 6）。
3. `apiConfigFromEnv`：用注入的假 env 测试。对 mock / openai / openrouter / deepseek 四种 `PROVIDER`，结果和拆分前 `createApi()` 内部用的 baseURL、key 一致；`*_BASE_URL` 能覆盖默认地址；非 mock 缺 key 时，报错信息带对应的环境变量名。
4. 检查：`runtime/sdk.ts` 里不出现 `process.env`；`host/` 以外的 coding-agent 代码不 import `host/`。
5. CLI：`PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts`，喂一行输入，表现和改动前一致。

## 自审结论

- 方案符合依赖方向 `coding-agent → agent → ai`：SDK 只用 ai 和 agent 的公开导出。也符合已有决定：模型由调用方指定、Session 负责构造 Agent、不引入 SessionManager。
- 对外接口只做新增或兼容性修改，回滚范围清楚。
- 动了两个包的导出，按规则实现完成后要做一轮代码审查。
- 有一点需要用户确认（见下面第 3 条）：对 sessionPath 的决定，我理解为“SDK 层必填，Host 层不填时默认写到 `.sessions/`”。

## 用户的决定

1. 采用方案 C：参照 pi 的模式，在 `runtime/sdk.ts` 提供 SDK 入口，以后对外暴露。
2. `@mini-pi/ai` 增加显式配置入口，SDK 不读环境变量（按 AI 的建议）。
3. sessionPath：SDK 必填；Host 不填时默认写到 `<cwd>/.sessions/`；不加内存模式。
4. 主要代码由用户编写；AI 负责设计文档、提示和审查。
5. `createApi(config)` 遇到显式配置缺 key 时不回退读环境变量，直接报错（2026-11-19）。
6. `streamFn` 和 `api` 同时给出时优先使用 `streamFn`，不报错（2026-11-22，用户实现时决定）。
7. sessionPath 的父目录由 `SessionStorage` 创建（远程 `persist and restore session` 提交已实现），Host 不再自己 mkdir。
8. CLI 不再写死 `/tmp/foo.jsonl`（那是临时调试写法），改为参考 pi 用 `--session` / `--session-dir` / `MINI_PI_SESSION_DIR` 传入；形参 `sessionName` 改为 `HostArgs`（2026-11-22，第 1 轮审查第 1 条）。
9. mock 读 `MOCK_*` 环境变量作为例外写进设计（第 1 轮审查第 5 条）。
10. 显式配置 openrouter 也带默认请求头（第 1 轮审查第 6 条）。
11. `ApiConfig` 放进 `HostOptions`，provider 只解析一次（第 1 轮审查第 7 条）。

## 实现记录（2026-11-22）

- `@mini-pi/ai`：provider 表 + `apiConfigFromEnv(env)` + `createApi(config = apiConfigFromEnv())`；ai smoke 用注入的假 env 覆盖默认地址、`*_BASE_URL` 覆盖、mock、未知 provider、openrouter 请求头、缺 key 报错。
- `runtime/sdk.ts`：`createSession()`；包入口导出 SDK 和 `CodingAgentSession` 类型。
- `host/bootstrap.ts`、`host/args.ts`：把命令行参数和环境变量转成 `createSession` 参数；`HostOptions.api` 只解析一次。
- 新增 `test/host-smoke.ts`：参数解析、provider 单一来源、session 路径优先级。
- ai smoke 用替身 `fetch` 截获请求，逐一对比 openrouter 请求头和拆分前的默认值。
- 新增 `test/sdk-smoke.ts`（跑通一轮、model 和默认工具传到请求、`tools: []` 不被替换、streamFn 优先、不读环境变量）和 `test/session-smoke.ts`（持久化、恢复、dispose 后拒绝 prompt）。
