# 模型由调用方指定，记录在 AgentState

2026-11-18 · 用户拍板 · 生效

**决定**：Agent 不再写死模型名；模型由调用方传入并记录在 `AgentState` 中，loop 每次调用模型时从状态里读取（参考 pi）。

**为什么**
- 写死的模型名会让非 DeepSeek 的 provider 请求失败。
- `@mini-pi/ai` 约定不替调用方选模型，Agent 作为中间层也不应该选。
- 放进状态后，运行期间可以查询当前模型，以后也能支持切换模型。

**补充（2026-11-19）**：Host 从 `MODEL` 环境变量读取模型；`mock`、`deepseek` 有默认值，其他 provider 未设置时启动报错。模型在 prompt 之间切换、运行中途切换（`prepareNextTurn`）都还没做。
