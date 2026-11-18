# 双层 agent loop 与 Agent 状态 · 代码审查

2026-11-18 · 第 1 轮审查 · 部分问题已裁决，剩余问题待处理

审查范围：`b259adf..1a4ff37`（`fix(coding-agent)` 修正 `appendEntry`；`feat(agent)` 跑通双层 loop 与事件驱动的 Agent 状态）。按用户要求先推送到 `master`，再审查。

## 验证

- `npm run typecheck`：0 errors。
- `npm run smoke`：agent / ai / coding-agent / cross-package 全部通过。
- 审查人另用临时脚本复现了 abort 和 isError 的问题，脚本已删除。

## 问题

### 必须修

1. Agent 把模型名写死为 `"deepseek"`（`agent.ts` 的 `createLoopConfig`）。使用 OpenAI / OpenRouter 时请求的模型不存在，整次 prompt 失败；也和 ai 层“不替调用方选模型”的约定冲突。mock 不读 model，smoke 测不出。

### 需要人判断

2. abort / 出错时生命周期不完整：工具执行中 `steer()` 后 `abort()`，`prompt()` 抛错；事件流停在 `message_start`，没有 `message_end` / `turn_end` / `agent_end`；abort 后的 steering 被写进历史；队列不清空。
5. 流式输出的决定（先非流式跑通）和实际实现不一致；PROGRESS 第 5 步仍写“实现流式输出”。

### 建议

3. abort 后同一轮剩下的工具仍会执行，不检查 signal 的写工具会继续写盘。
4. 用 `"ERROR:"` 前缀判断 `isError` 会误判，走 OpenAI 时还会重复加 `[ERROR]` 前缀；建议 `executeTool` 返回 `{content, isError}`。
6. `agent_end.messages` 传的是整份历史，含义未定义；Session 若据此写 JSONL 会重复写旧消息。
7. 测试缺口：abort、streamFn 抛错或没有 done、工具错误路径、`tool_execution_update` 都没有测试。

## 用户的决定

- 本轮提交中 `agent-loop.ts` 是整文件重写，超出了必要范围（改了参数含义、删了 try/catch、改了分支和变量结构）。用户决定保持现状。
- 第 1 条：参考 pi，把模型写进 `AgentState`，由用户实现。见 [决定](../decisions/2026-11-18-model-in-agent-state.md)。
- 第 5 条：流式输出要上，旧决定标为部分被替代，PROGRESS 第 5 步改为“Host 端流式渲染 + 上下文压缩”。见 [决定](../decisions/2026-11-18-streaming-in-loop.md)。
- 第 2 条：讨论中。已决定先给 assistant `Message` 加 `stopReason` / `errorMessage`、`StopReason` 加 `"aborted"`，见 [决定](../decisions/2026-11-18-assistant-stop-reason.md)；队列部分已处理：loop 在 signal 中止后不再取 steering / follow-up，Agent 增加 `clearAllQueues()`，Session 增加 `clearQueue()`，见 [决定](../decisions/2026-11-18-abort-queue-handling.md)。模型流中途中止时仍会抛错、事件不完整，待实现。
- 第 3、4、6、7 条：待定。
