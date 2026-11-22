# SessionEventHub 暂不接入

2026-11-22 · 用户拍板 · 生效

**决定**：`SessionEventHub` 作为后续扩展保留，本轮 P0 不接入统一 hub；当前只保留 `message_end` 持久化 handler。

**为什么**
- 先把 Session 持久化、恢复、dispose 和 Host 生命周期闭环。
- 统一事件 hub 涉及 queue、extensions、public listeners、compaction 和 retry，需要单独设计和测试。

后续扩展内容记录在 `docs/reviews/2026-11-22-pi-stream-lifecycle.md` 及后续设计中。
