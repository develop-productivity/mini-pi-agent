# 范围：只做 OpenAI 兼容格式；TUI 要能滚动、要有简单的权限弹窗；session 和 MCP 各一个文件

2026-10-24 · 用户拍板 · 部分被替代（session/MCP 单文件部分，见 [2026-11-08-session-mcp-file-layout.md](2026-11-08-session-mcp-file-layout.md)）

**决定**：provider 只做 OpenAI 兼容格式和 mock，不做 Anthropic 原生格式；TUI 支持鼠标滚轮翻看之前的内容，权限确认用简单的弹窗（询问一次：允许 / 拒绝），不做复杂的弹窗交互；session 和 MCP 各自写成一个文件。

**为什么**
- 长对话必须能往回翻。
- 权限必须问用户，但不需要多级菜单。
- 每个模块尽量一个文件，读起来不用跳。

> Session 和 MCP 的单文件限制已于 2026-11-08 被替代；其余范围决定继续生效。

细节见 `docs/DESIGN.md`「保留 vs 砍掉」。
