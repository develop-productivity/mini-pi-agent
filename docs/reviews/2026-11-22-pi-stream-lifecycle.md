# pi 风格流式生命周期 · 代码审查

2026-11-22 · 第 1 轮审查 · 第 1、2 条已修复（2026-11-24），第 3–6 条待定

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

## 第 1、2 条的修复（2026-11-24）

用户决定先修两条「必须修」，因为 Session 已经持久化，悬空的 tool call 会让 session 无法继续使用。

修改（`packages/agent/src/core/agent-loop.ts`）：

- 第 1 条：流读取中每个事件前检查 abort，命中即停止；流结束后再复核一次 abort，provider 照样发出 `done` 也会记为 `aborted`。provider 已经给出失败结果时保留原错误信息。
- 第 2 条：`settleMessage` 统一处理 `done` / `error`，失败的消息去掉 toolCalls；`fail()` 同样去掉；工具批处理中途 abort 时给剩余 tool call 补 `ERROR: Operation aborted` 结果；`buildRequest` 发给模型时去掉失败消息的 toolCalls、保留文字，没有文字的整条不发。决定见 [2026-11-24-failed-assistant-messages.md](../decisions/2026-11-24-failed-assistant-messages.md)。

测试（`packages/agent/test/loop-smoke.ts`）：`assertNoDanglingToolCalls` 加 7 个场景（text 后 abort、tool 参数流中 abort、流中抛错、error 事件、done 自带失败、两个工具中途 abort、先报错后 abort）。除“流结束后的 abort 复核”外，每一处修复都做了反向验证（去掉该修复，对应测试失败）；该复核只在“done 已处理、流尚未结束时 abort”的时序下起作用，目前没有用例覆盖（第 2 轮审查第 2 条，已延后）。

### 修复的审查（第 1 轮）

无「必须修」。需要人判断：失败消息整条不发给模型是新约定且未记录。建议：done 自带失败时未去 toolCalls；补上的结果不发工具事件、不带 `ERROR:` 前缀；流中不检查 abort、真实错误信息会被改写；缺 tool 参数流中 abort 和 session 层的测试，文档未更新。

用户的决定：

1. 失败消息只去掉 toolCalls，保留文字发给模型（没有文字的整条不发）。
2. done 自带失败 stopReason 时也去掉 toolCalls。
3. 补上的结果不发工具事件；内容由用户改为 `ERROR: Operation aborted`。
4. 流中检查 abort，并保留真实错误信息：由 AI 修改。
5. 测试和文档：本次补上 tool 参数流中 abort 的测试和文档；session 层的测试待用户决定。

### 修复的审查（第 2 轮）

无「必须修」。实现与用户 5 条决定一致，原第 1、2 条对新产生的消息已解决。

1. 需要人判断：修复前批处理中途 abort 存下的旧 session，恢复后仍有悬空 tool call，会被 provider 拒绝。
2. 建议：流结束后的 abort 复核没有测试覆盖，审查记录“每一处都反向验证”不准确。
3. 建议：没有断言跳过的工具不发 `tool_execution_*` 事件。
4. 建议：`agent.ts` 中“loop 不会发 agent_end”的注释已过时。

用户的决定：

- 第 1 条：现在修复。`buildRequest` 最后一步 `closeDanglingToolCalls` 给悬空的 tool call 补 `ERROR: No result provided`，紧跟在已有结果之后，只作用于请求；新增“旧 session 悬空调用”测试，反向验证通过（不补、补在末尾都会失败）。
- 第 2–4 条：延后。审查记录中“每一处都反向验证”的说法已改为如实描述。
- 上一轮的 session 层测试：延后。

### 修复的审查（第 3 轮，最后一轮）

无「必须修」、无需要人判断。确认补结果位置正确、只作用于请求、不影响正常流程、无绕过 `buildRequest` 的入口、可回滚。

建议（用户决定延后）：

1. 反方向未处理：有 tool result 但找不到对应调用的孤立消息。compaction 的 `firstKeptEntryId` 落在 tool entry 上时会出现（`session/build.ts`），本次之前就存在；做上下文压缩时一并处理。
2. 补结果只看紧跟在 assistant 后的连续 tool 消息；若以后允许往历史中间插消息，需要重新检查。现有 loop 不会产生这种顺序。

三轮审查结束，无遗留「必须修」。

