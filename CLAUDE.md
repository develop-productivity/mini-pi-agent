@AGENTS.md

## Claude Code 专用

在本目录启动时，Claude Code 还会加载上一级的 `../CLAUDE.md`（审查子 agent 怎么开、审查结果怎么给用户），这里不重复。

- 用中文回复。讲解代码时用 `[文件:行号](路径#L行号)` 的链接指到具体位置。
- 本机没有 `gh` 命令。提 PR 的做法：推送分支后，给用户一个预填好的 compare 链接：
  `https://github.com/develop-productivity/mini-pi-agent/compare/master...<分支>?expand=1&title=<标题>&body=<描述>`（标题和描述做 URL 编码）。
- 用户说"合并"时，提醒用户在 GitHub 页面上点 Merge；不要在本地合并后直接推 `master`。
- 运行 demo 时注意 `demo:mock`、`demo:loop` 会等待键盘输入，非交互地跑要从 stdin 喂一行，并加 `timeout`。
