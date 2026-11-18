# abort 不自动清空队列，由上层取回排队消息

2026-11-18 · 用户拍板 · 生效

**决定**：`Agent.abort()` 只中止当前运行；loop 在 signal 已中止时不再取 steering / follow-up。`Agent.clearAllQueues()` 清空两个队列并返回被清掉的消息，`CodingAgentSession.clearQueue()` 把它们转成文本交给 Host，由 Host 决定是否放回输入框（参考 pi）。

**为什么**
- 排队的消息是用户还没发出的输入，直接丢弃会丢失用户输入；放回哪里是 UI 的事，Agent 不该替上层决定。
- abort 之后再从队列取消息，会把过期的插话写进历史。
- 和 pi 不同：pi 的 `clearAllQueues()` 不返回值，AgentSession 另外维护一份文本副本并靠事件对账；mini-pi 直接让 Agent 返回被清掉的消息，只保留一个数据来源。
