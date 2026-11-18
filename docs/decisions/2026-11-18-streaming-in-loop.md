# Agent loop 直接基于流式接口

2026-11-18 · 用户拍板 · 生效（替代 [2026-10-24-streaming-compaction.md](2026-10-24-streaming-compaction.md) 中“先用非流式 `complete()` 跑通”的部分）

**决定**：Agent loop 通过注入的 `StreamFn` 调用模型，并发出 `message_update` 增量事件；不再先做非流式版本。

**为什么**
- `@mini-pi/ai` 的 `stream()`（OpenAI SSE 和 mock）已经实现，loop 直接用它，省掉一次从 `complete()` 到 `stream()` 的迁移。
- Host 需要边生成边显示，增量事件要从 loop 层就有。
