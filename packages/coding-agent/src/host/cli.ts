/**
 * CLI 入口（对应 pi 的 cli.ts + main.ts）：解析参数 → 创建 session → 按模式分发 → 清理退出。
 *
 *   PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts                         # interactive
 *   PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts --mode print "现在几点？" # 单次运行
 *   PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts --mode rpc              # stdin/stdout JSONL
 *
 * 通用参数：--session <path>、--session-dir <dir>（或环境变量 MINI_PI_SESSION_DIR）。
 *
 * 各模式只负责输入输出；session 的创建和销毁都在这里，三种模式共用。
 * 注意：rpc 模式下 stdout 只能出现协议数据，这里的提示和报错都写 stderr。
 */
import { parseHostArgs } from "./args.ts";
import { createHostSession, resolveHostOptions } from "./bootstrap.ts";
import { runInteractiveMode } from "./modes/interactive.ts";
import { runPrintMode } from "./modes/print.ts";
import { runRpcMode } from "./modes/rpc/rpc-mode.ts";

try {
    process.loadEnvFile();
} catch {
    // 没有 .env 就用当前环境变量
}

async function main(): Promise<number> {
    const args = parseHostArgs(process.argv.slice(2));
    const mode = args.mode ?? "interactive";
    if (mode === "print" && !args.messages?.length) {
        throw new Error('print 模式需要至少一条消息，例如：--mode print "现在几点？"');
    }
    if (mode !== "print" && args.messages?.length) {
        throw new Error(`位置参数只在 print 模式下使用：${args.messages.join(" ")}`);
    }

    const options = resolveHostOptions(args);
    const session = await createHostSession(options);
    try {
        switch (mode) {
            case "interactive":
                await runInteractiveMode(session, options);
                return 0;
            case "print":
                return await runPrintMode(session, { messages: args.messages ?? [], format: "text" });
            case "rpc":
                await runRpcMode(session, options);
                return 0;
        }
    } finally {
        await session.dispose();
    }
}

main().then(
    (code) => process.exit(code),
    (error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    },
);
