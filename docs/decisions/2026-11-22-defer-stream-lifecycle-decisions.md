# 流式生命周期审查问题延后到下一次 session

2026-11-22 · 用户拍板 · 生效

**决定**：`2026-11-22-pi-stream-lifecycle` 审查中的第 1–6 条全部留到下一次 session 决定，本轮只继续推进 Session 持久化、恢复、dispose 和 Host 生命周期。

**为什么**
- 当前优先完成 Session 核心闭环。
- 流式 abort、悬空 toolCalls、done/stopReason 协议等需要单独决策，不能混在持久化改动里顺手修改。

关联审查：`docs/reviews/2026-11-22-pi-stream-lifecycle.md`。
