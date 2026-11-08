# Host、AgentUI 与 coding-agent 核心类

2026-11-08 · 设计草稿 · 等待用户实现与拍板

## 要解决什么

下一阶段需要确定 `AgentUI`、Host 和 `coding-agent` 核心类的持有关系，避免重新把显示逻辑放回 `@mini-pi/agent`。

核心约束：

- Host 是入口和 I/O 适配层，不实现 Agent 决策循环。
- Agent 只产生事件和状态变化，不依赖 CLI/TUI 类型。
- `coding-agent` 负责把模型、工具、session、sandbox 组合成产品级运行时。

## 候选关系

```text
Host（CLI/TUI/RPC）
  ├── 接收输入、渲染输出、处理权限交互
  └── 持有并驱动 CodingAgentSession
          ├── 持有 Agent
          ├── 直接持有 SessionStorage
          ├── 提供工具、hooks、sandbox
          └── 订阅 AgentEvent 并持久化事实
              └── Agent 只负责循环、队列、事件和工具执行
```

备选方案是让 Agent 接收 `AgentUI` 端口。该方案直接但不推荐，因为 Agent 会再次理解显示语义，并让 headless、RPC、测试宿主都被迫实现 UI 接口。

## 待回答问题

1. `AgentUI` 是 Host 内部的事件渲染器，还是需要注入给 `CodingAgentSession` 的展示端口？
2. `CodingAgentSession` 直接持有 Agent、SessionStorage 和产品级资源；不引入独立 SessionManager。
3. ~~Host 创建 Agent，还是 Host 只创建 `CodingAgentSession`，由后者创建 Agent？~~ 已决定：由 Session 工厂创建 Agent。
4. 哪些事件由 Agent 发出，哪些产品级事件由 `coding-agent` 扩展？
5. `CodingAgentSession` 负责调用 `SessionStorage` 持久化，不通过 Host subscriber 完成。
6. 如何借鉴 Pi 的 `Agent`、`AgentSession`、`StreamFn`、`AgentTool` 和 ResourceLoader 抽象，同时保持 mini-pi 的精简？

## 借鉴 Pi 的重点

- Pi 的低层 `Agent` 不依赖 UI，只维护状态、循环、队列和事件。
- `AgentSession` 在产品层组合模型、工具、会话、压缩和扩展。
- 模型调用通过 `StreamFn` 注入，Agent 不直接依赖具体 provider。
- 工具通过 `AgentTool` 抽象，内置工具和 MCP 工具最终归一成同一接口。
- Host 订阅事件并负责展示；持久化由 session 层负责，而不是由 UI 观察者负责。

## 风险

- 如果 Agent 持有 AgentUI，会重新引入 Host 反向语义依赖。
- 如果 Host 直接拼装所有内部对象，`coding-agent` 会退化成空壳。
- 如果 session 持久化依赖事件订阅者，监听器失败可能丢失事实。

## 怎么验证

1. `@mini-pi/agent` 不 import `@mini-pi/coding-agent` 或 Host 类型。
2. headless 测试宿主可以只订阅事件运行 Agent。
3. CLI 和 TUI 共享同一个 `coding-agent` 核心类。
4. session 重启后可以从持久化事实重建上下文。

## 自审结论

当前只是待决策设计，不改变代码。推荐采用“Host 持有 CodingAgentSession，CodingAgentSession 持有 Agent，Agent 只发事件”的方向，等待用户实现时确认。

## 用户的决定

- 不引入独立 `SessionManager`；由 `CodingAgentSession` 直接持有 `SessionStorage`。
- 采用方案 B：Host 创建并持有 `CodingAgentSession`，`createCodingAgentSession()` 在内部构造 Agent；Agent 保持私有。
