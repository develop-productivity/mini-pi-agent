# 不引入独立的 SessionManager

2026-11-08 · 用户拍板 · 生效

**决定**：第一阶段不单独实现 `SessionManager`；`CodingAgentSession` 直接持有并使用 `SessionStorage`。

**为什么**
- 当前只支持单用户、单会话，额外 manager 没有独立职责。
- 先减少一层没有实际行为的包装，后续确有需要再引入。
