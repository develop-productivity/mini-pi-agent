@AGENTS.md

## Claude Code 专用

- 用中文回复。讲解代码时用 `[文件:行号](路径#L行号)` 的链接指到具体位置。
- 本机没有 `gh` 命令。提 PR 的做法：推送分支后，给用户一个预填好的 compare 链接：
  `https://github.com/develop-productivity/mini-pi-agent/compare/master...<分支>?expand=1&title=<标题>&body=<描述>`（标题和描述做 URL 编码）。
- 用户说"合并"时，提醒用户在 GitHub 页面上点 Merge；不要在本地合并后直接推 `master`。
- 代码审查的审查人：用 Agent 工具新开子 agent，`subagent_type` 用 `general-purpose`。**不要用 `fork`**，fork 会继承当前对话，就不是新上下文了。每一轮都新开一个，不要让上一轮的审查人接着审。
- 审查结果用中文原样列给用户，标出「必须修 / 建议 / 需要人判断」，然后结束这一轮回复，等用户逐条决定；不要在同一轮里接着改。
- 运行 demo 时注意 `demo:mock`、`demo:loop` 会等待键盘输入，非交互地跑要从 stdin 喂一行，并加 `timeout`。
