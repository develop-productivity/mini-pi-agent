# 参考 pi 提供 coding-agent SDK 入口

2026-11-19 · 用户拍板 · 生效

**决定**：在 `packages/coding-agent/src/runtime/sdk.ts` 提供唯一对外的组装入口 `createSession()`，从包入口导出；SDK 不读环境变量，`model` 和 `sessionPath` 必填，由 Host 把环境变量转成参数（sessionPath 默认值 `<cwd>/.sessions/` 在 Host 层决定）；`@mini-pi/ai` 的 `createApi()` 支持显式配置，只有 `apiConfigFromEnv()` 读环境变量，显式配置缺 key 时直接报错、不回退读环境变量（和 pi 不同）。不加内存模式 session。设计见 [2026-11-19-coding-agent-sdk.md](../designs/2026-11-19-coding-agent-sdk.md)。

**为什么**
- 组装逻辑可以被 CLI、以后的 print / RPC 模式和外部程序共用。
- 显式参数让调用方看得见、控制得了 provider、模型和文件位置。
- 只学 pi 的模式，不照搬它多层的规模。

**补充（2026-11-22，用户拍板）**
- `streamFn` 和 `api` 同时给出时优先用 `streamFn`，不报错。
- sessionPath 的父目录由 `SessionStorage` 创建。
- mock 读 `MOCK_*` 环境变量是“SDK 不读环境变量”的例外，只影响离线测试。
- 显式配置 openrouter 也带默认请求头（默认值放在 provider 表里）。
- Host 的 provider 配置只解析一次，放进 `HostOptions.api`；CLI 的 session 文件参考 pi 由 `--session` / `--session-dir` / `MINI_PI_SESSION_DIR` 指定，默认 `<cwd>/.sessions/`。
