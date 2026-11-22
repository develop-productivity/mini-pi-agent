# 参考 pi 的流式生命周期

2026-11-22 · AI 起草，用户要求实现

## 当前状态

- 已实现：`start` / `error` 事件、partial assistant message、`message_update`、`message_end` 配对、stream 抛错/缺少 `done`/abort 的基础测试。
- 待决策：abort 被 `done` 掩盖、悬空 toolCalls、重复 `start`、缺失 `stopReason`、OpenAI `[DONE]` 语义、补充回归测试。详见 `docs/reviews/2026-11-22-pi-stream-lifecycle.md`。

## 要解决什么

当前 `streamAssistantResponse` 在读取流之前自行发送 `message_start`，但 provider 流没有明确的 `start` / `error` 事件；当 `streamFn` 抛错、stream 没有 `done` 或 abort 时，可能只有 `message_start`，没有对应的 `message_end`。

目标是参考 pi：

- provider 流发送 `start`、增量事件和最终的 `done` / `error`；
- Agent 只在收到 `start` 时发送 `message_start`；
- 每个 text/tool 增量都发送 `message_update`；
- `done` / `error` 最终发送一次 `message_end`；
- stream 异常或没有 `done` 时，生成带 `stopReason` / `errorMessage` 的 assistant message；
- run 以 `turn_end` 和 `agent_end` 收尾。

## 方案

扩展 `@mini-pi/ai` 的 `StreamEvent`：

```text
start
text_delta
tool_use_start
tool_use_delta
tool_use_end
done
error
```

`streamAssistantResponse` 自己维护 partial assistant message，并在最后用 provider 返回的完整消息替换它。mock 和 OpenAI provider 都先发 `start`，最后发 `done`；异常由 `streamAssistantResponse` 兜底转换为 `message_end`。

## 风险

- 如果 provider 发送多个 `start`，需要只认第一个；
- tool argument 的部分 JSON 不一定可解析，partial message 只保证生命周期，不保证每个中间 toolCall 都可执行；
- provider 流没有 `done` 时必须显式标记为错误，不能静默成功；
- AgentEvent 的监听器仍然不能承担持久化等关键职责。

## 怎么验证

1. `npm run typecheck` 通过。
2. `npm run smoke` 通过。
3. agent smoke 断言 `message_start → message_update* → message_end`。
4. 增加 stream 抛错和缺少 `done` 的测试，断言最终出现 `stopReason`、`turn_end`、`agent_end`。

## 自审结论

方案与已有流式决定一致，改动集中在 AI 流协议、agent loop 和测试，可按提交回滚。

## 用户的决定

- 用户要求参考 pi 的 start/update/done/error 形式实现。
- 第 1–6 条审查问题留到下一次 session 决定。
