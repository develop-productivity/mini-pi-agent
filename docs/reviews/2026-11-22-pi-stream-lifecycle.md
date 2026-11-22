# pi 风格流式生命周期 · 代码审查

2026-11-22 · 第 1 轮审查 · 用户决定待定

设计：[2026-11-22-pi-stream-lifecycle.md](../designs/2026-11-22-pi-stream-lifecycle.md)。

## 验证

- `npm run typecheck`：0 errors。
- `npm run smoke`：ai / agent / coding-agent / cross-package 全部通过。

## 必须修

1. abort 可能被 provider 的 `done` 掩盖：mock 在部分阶段不再检查 signal，`streamAssistantResponse` 收到 `done` 时也不复核 `request.signal.aborted`。
2. error/abort 可能留下没有 tool result 的 assistant tool call：失败 partial 可能包含未完成的 toolCalls；工具批处理中途 abort 时剩余 tool call 没有对应结果。

## 需要人判断

3. 重复 `start` 会重置 partial message，导致已累积文本回退。
4. `done` 缺少 `stopReason` 时当前仍按成功处理，需要明确 live stream 协议是否要求终止原因。
5. OpenAI `[DONE]` 没有 `finish_reason` 时默认 `end_turn`，可能把不完整响应当成功。

## 建议

6. 测试没有完全验证生命周期恰好一次、悬空 toolCalls、tool streaming 中 abort、重复 start 和 OpenAI adapter 异常路径。

## 用户的决定

- 第 1–6 条全部留到下一次 session 决定。
- 本轮先推进 Session 持久化、恢复、dispose 和 Host 生命周期。
