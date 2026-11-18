# assistant 消息带上 stopReason 和 errorMessage

2026-11-18 · 用户拍板 · 生效

**决定**：`@mini-pi/ai` 的 assistant `Message`（`AssistantMessage`）增加可选的 `stopReason` 和 `errorMessage`，`StopReason` 增加 `"aborted"`；调用失败或被中止也编码成一条 assistant 消息，不靠异常传递（参考 pi）。provider 在返回的消息上同时写入 `stopReason`。

**为什么**
- 失败和中止要能进历史、写进 session、在 UI 上显示，异常做不到。
- 和 pi 的消息模型一致，后续 abort / 出错的生命周期按这个形状实现。
- 字段设为可选：旧的 session JSONL 和手写的历史消息没有它，仍然合法（这一点和 pi 不同，pi 是必填）。
