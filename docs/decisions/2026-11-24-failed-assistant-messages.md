# 失败的 assistant 消息：去掉 toolCalls，保留文字

2026-11-24 · 用户拍板 · 生效

**决定**：stopReason 为 error / aborted 的 assistant 消息一律不带 toolCalls（不分 done / error 事件）；留在历史和 session JSONL 里，发给模型时保留已经输出的文字，没有文字的整条不发。工具批处理中途 abort 时，剩余的 tool call 补一条 `ERROR: Operation aborted`（`isError: true`）结果，不发 `tool_execution_*` 事件。流式读取中一旦 abort 就不再处理后续事件。

**为什么**
- 没有结果的 tool call 会让下一次请求被 OpenAI 兼容接口拒绝，并且会随持久化一直留在 session 里。
- 保留已输出的文字，用户中止后说“继续”，模型能接着之前的内容；只去掉 toolCalls 已经足以避免悬空调用（和 pi 整条过滤的做法不同）。
- 被跳过的工具没有执行，不发执行事件；结果文本沿用 executor 的 `ERROR:` 前缀约定。

**补充（同日，第 2 轮审查后用户拍板）**：修复前存下的旧 session 可能有悬空的 tool call（批处理中途 abort 时直接 `break`，留下正常的 `assistant(tool_use)`）。发请求时给没有结果的 tool call 补一条 `ERROR: No result provided`（`isError: true`），紧跟在该 assistant 已有的 tool result 之后；只作用于请求，不修改历史和 JSONL（参考 pi 的 `transform-messages`）。
