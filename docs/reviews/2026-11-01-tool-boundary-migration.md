# 工具边界迁移 · 代码审查

2026-11-01 · 第 1 轮审查 · 用户决定待定

设计：[2026-11-01-tool-boundary-migration.md](../designs/2026-11-01-tool-boundary-migration.md)。PR #2，分支 `fix/tool-boundary-migration`。

## 验证

- `npm ci`：通过，lockfile 未变化。
- `npm run typecheck`：通过，0 errors。
- `npm run smoke`：包内 smoke 和跨包 smoke 全部通过。
- PR CI：成功。

## 问题

### 必须修

1. Bash 工具可以绕过工作区路径约束：`cwd` 不是安全边界，绝对路径和 `cd ..` 可以访问工作区外文件。
2. 路径检查可被符号链接绕过：词法路径检查后跟随 symlink，可以读写工作区外文件。
3. `AbortSignal` 已取消时仍会执行有副作用的工具。
4. Session 和 MCP 的文件拆分违反已生效的“各一个文件”决定。
5. MCP server 命令不存在时会产生未处理的 `ChildProcess` error，导致进程退出。
6. 根 `cli` / `tui` 脚本被删除，违反新建 `coding-agent` 时的仓库规则。

### 需要人判断

7. 实际改动范围明显大于设计和回滚声明，建议拆分 PR 或更新设计。

### 建议

8. 测试未覆盖 symlink、abort、文件工具、MCP 错误和 OpenAI translator payload。
9. MCP 配置中的 `env` 未传给子进程，`callTool` 没有保留 `isError`。
10. Session compaction 对无效 `firstKeptEntryId` 会静默丢失上下文。

## 用户的决定

待用户逐条决定。
