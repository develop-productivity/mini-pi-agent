# CodingAgentSession 负责构造 Agent

2026-11-08 · 用户拍板 · 生效

**决定**：采用方案 B。Host 只调用 `createCodingAgentSession()` 并持有返回的 Session；由 Session 工厂在内部构造 Agent，Agent 不通过公开配置由 Host 预先构造。

**为什么**
- CLI、TUI 和 RPC 可以共享同一套 Agent 装配逻辑。
- Host 保持输入输出和生命周期适配职责，不深入 Agent 内部。
- Session 可以统一管理 Agent、SessionStorage 和产品的生命周期。

关联设计：[Host、AgentUI 与 coding-agent 核心类](../designs/2026-11-08-host-agent-ui-boundary.md)。
