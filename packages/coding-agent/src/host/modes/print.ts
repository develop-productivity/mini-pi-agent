/**
 * print 模式：单次运行，发送消息 → 输出结果 → 退出（对应 pi 的 modes/print-mode.ts）。
 *
 *   PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts --mode print "现在几点？"
 *
 * 用途：脚本、CI、管道里调用 agent，不需要 readline 交互。
 *
 * TODO（用户实现）：
 *   1. 没有消息时报错（cli.ts 已检查一次，这里可以不重复）。
 *   2. 依次 await session.prompt(message)，不要并发：每条都要等上一条跑完。
 *   3. 输出方式二选一，先做 text：
 *      - text：只在最后把最后一条 assistant 消息的 content 写到 stdout。
 *        提示：订阅事件，在 message_end 且 role === "assistant" 时记下它。
 *      - json（可选）：每个 AgentEvent 都用 serializeJsonLine() 写一行，和 rpc 的事件格式一致。
 *   4. 最后一条 assistant 消息的 stopReason 是 "error" / "aborted" 时，
 *      把 errorMessage 写到 stderr，并返回非 0 退出码。
 *   5. 返回退出码，由 cli.ts 负责 dispose 和退出进程。
 */
import type { CodingAgentSession } from "../../runtime/coding-agent-session.ts";

export interface PrintModeOptions {
    /** 依次发送的消息（命令行的位置参数）。 */
    messages: string[];
    /** text：只输出最终回复；json：输出完整事件流（JSONL）。 */
    format: "text" | "json";
}

/** 返回进程退出码：0 成功，非 0 失败。 */
export async function runPrintMode(session: CodingAgentSession, options: PrintModeOptions): Promise<number> {
    void session;
    void options;
    // TODO: 按文件头的步骤实现
    process.stderr.write("print 模式还没有实现（见 host/modes/print.ts 的 TODO）\n");
    return 1;
}
