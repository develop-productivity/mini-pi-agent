# 运行时组合关系

2026-11-10 · 用户拍板 · 生效

**决定**：产品级调用关系是 `Host → CodingAgentSession → Agent → agent loop`；`@mini-pi/ai` 是 Agent 的模型依赖，`session/` 是 `CodingAgentSession` 持有的持久化组件，`sandbox` 是 `coding-agent` 提供的工具执行适配能力，不是 loop 的下层。

**为什么**
- 旧图把调用方向、依赖方向和状态持有关系混在一起。
- `SessionStorage`、sandbox 和 hooks 都是产品运行时的组件，不是 Agent loop 的下层。
- Agent 应只依赖模型、工具和事件的抽象。
