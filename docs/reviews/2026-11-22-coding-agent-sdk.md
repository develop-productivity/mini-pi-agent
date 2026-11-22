# coding-agent SDK 入口 · 代码审查

2026-11-22 · 第 1 轮审查 · 已按用户决定处理

设计：[2026-11-19-coding-agent-sdk.md](../designs/2026-11-19-coding-agent-sdk.md)。审查对象是合并远程 `persist and restore session` 等提交之后、尚未提交的 SDK 改动。

## 验证（审查人实跑）

- `npm run typecheck`：0 errors。
- `npm run smoke`：agent / ai / coding-agent / sdk / session / cross-package 全部通过。
- `PROVIDER=mock` 跑 CLI 正常；`PROVIDER=deepseek` 缺 key 时启动即报 `DEEPSEEK_API_KEY 未设置`。

## 问题

没有「必须修」。

### 需要人判断

1. CLI 固定写 `/tmp/foo.jsonl`：跨项目、多开时历史串在一起；Host 层 `.sessions/` 默认值用不到，没有测试。形参 `sessionName` 实际是完整路径。

### 建议

2. 决定文件没记录决定 6（streamFn 优先）和决定 7（SessionStorage 建目录）。
3. 设计「不做」「怎么验证」与决定 6、持久化现状矛盾。
4. `host/types.ts` 注释和 `docs/DESIGN.md` 仍写 createApi 读 env；DESIGN 没有 `runtime/sdk.ts`。
5. mock 仍读 `MOCK_SCRIPT` 等变量，"SDK 不读环境变量"的说法和 smoke 受本机环境影响。
6. 显式配置 openrouter 不带默认请求头；smoke 没有和旧默认值逐一对比。
7. `resolveHostOptions` 和 `createHostSession` 分别接收 env，显示的 provider 可能和实际不一致。
8. 顺带的持久化收尾（session smoke）和无关小改动，提交时最好分开或写明。

## 用户的决定与修改

| # | 决定 | 怎么改的 |
|---|---|---|
| 1 | `/tmp/foo.jsonl` 是临时调试写法，改成从命令行 / 环境变量传入，形参改名 | 参考 pi：新增 `host/args.ts`（`--session <path>`、`--session-dir <dir>`），环境变量 `MINI_PI_SESSION_DIR`；`resolveHostOptions(args, env, cwd)`；优先级 `--session` > `--session-dir` > `MINI_PI_SESSION_DIR` > `<cwd>/.sessions`；新增 `test/host-smoke.ts` |
| 2–4 | 过时和冲突的文档由 AI 改 | 决定文件补充 2026-11-22 的决定；设计正文用删除线标注被替代的内容；`host/types.ts` 注释、`docs/DESIGN.md` 目录结构更新 |
| 5 | 在设计里写明 mock 是例外 | 设计 `@mini-pi/ai` 一节新增“例外：mock provider” |
| 6 | 显式配置 openrouter 也带请求头 | 默认请求头放进 provider 表，`createApi` 合并 `{...表默认值, ...config.headers}`；`apiConfigFromEnv` 只把 `OPENROUTER_*` 转成覆盖项；ai smoke 用替身 `fetch` 截获请求，逐一对比旧默认值 |
| 7 | `ApiConfig` 放进 `HostOptions`，只解析一次 | `HostOptions.provider` 换成 `api: ApiConfig`；`createHostSession(options)` 不再接收 env |
| 8 | 提交时分开 | 按主题拆分提交 |

修改后：`npm run typecheck` 0 errors；`npm run smoke` 新增 host smoke，共 7 项全部通过；CLI 的 `--session`、`MINI_PI_SESSION_DIR`、未知参数报错均已实跑。
