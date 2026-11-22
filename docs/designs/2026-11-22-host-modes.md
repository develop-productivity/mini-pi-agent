# Host 运行模式：interactive / print / rpc

2026-11-22 · AI 起草并搭骨架，TODO 部分由用户实现

## 要解决什么

现在只有一个 readline CLI。其他程序（编辑器插件、Web 后端、脚本、CI）想驱动 mini-pi，只能模拟终端输入。需要参考 pi 的 `modes/`，在同一个 session 之上提供不同的输入输出方式。

## 方案

参考 pi：`cli.ts` + `main.ts` 负责入口，`modes/interactive`、`print-mode.ts`、`modes/rpc/` 负责各自的输入输出。

```
host/
  args.ts            --mode interactive|print|rpc；位置参数给 print 用
  cli.ts             入口：解析参数 → resolveHostOptions → createHostSession → 按模式分发 → dispose
  modes/
    interactive.ts   readline + renderer（原 cli.ts 的交互逻辑，行为不变）
    print.ts         单次运行：依次发送消息 → 输出最终回复 → 退出码
    rpc/
      types.ts       RpcCommand / RpcResponse / RpcOutput
      jsonl.ts       严格按 \n 切分的 JSONL 读写
      rpc-mode.ts    stdin 命令 → session；AgentEvent → stdout
```

- **session 的创建和 dispose 只在 `cli.ts`**，三种模式共用；模式函数返回时表示输入结束。
- **RPC 协议**（pi 的子集）：stdin / stdout 上一行一个 JSON。命令带可选 `id`，响应 `type: "response"` 原样带回 `id`；其余行都是原样转发的 `AgentEvent`。stdout 只出现协议数据，日志写 stderr。
- **prompt 的响应语义**：收到即回应“已接受”，运行过程和结果通过事件流表达；已有运行中的 prompt 时直接回失败，提示改用 steer / follow_up。
- **JSONL 不用 `node:readline`**：readline 会在 U+2028 / U+2029 处断行，而它们在 JSON 字符串里合法（同 pi 的 `jsonl.ts`）。

## 范围

- 已实现：参数、分发、interactive（搬迁）、JSONL、RPC 读写框架、事件转发、`prompt`、`steer`。
- 留给用户实现（文件里有 TODO 和提示）：print 模式；RPC 的 `follow_up`、`abort`、`clear_queue`、`get_state`、`set_model`。`get_state` 需要先给 `CodingAgentSession` 加只读状态方法。
- 不做：rpc client、`--mode json`、扩展 UI 请求、`new_session` 等 pi 的其他命令。

## 风险与回滚

- 只改 `coding-agent/src/host/` 和 host smoke，不改任何包的对外导出；回滚即还原本次提交。
- 原有 CLI 用法不变：不带 `--mode` 时仍是 interactive。

## 怎么验证

1. `npm run typecheck` 0 errors；`npm run smoke` 通过，host smoke 覆盖 `--mode` 解析和 JSONL 切分（U+2028、多字节跨 chunk、CRLF、无结尾换行）。
2. interactive：`printf '现在几点\n' | PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts` 跑通一轮。
3. rpc：往 stdin 写 prompt / steer / 非法行，stdout 依次出现响应和完整事件流，非法行得到 `command: "parse"` 的失败响应。
4. print：未实现时提示 TODO 并返回退出码 1。

## 自审结论

只在 Host 层加文件、改目录结构，依赖方向不变，SDK 和 Session 不变。用户补完 TODO 后需要一轮代码审查（改了目录结构，走了设计）。

## 用户的决定

- 用户要求参考 pi 新建 rpc 等 Host 的文件结构和大致框架（2026-11-22）。
