/**
 * Host 的命令行参数（参考 pi 的 cli/args.ts，只保留需要的几个）。
 *
 *   --mode <interactive|print|rpc>   运行模式，默认 interactive
 *   --session <path>                 直接打开 / 创建这个 session 文件（优先级最高）
 *   --session-dir <dir>              session 文件存放目录，覆盖环境变量 MINI_PI_SESSION_DIR
 *   其余不以 -- 开头的参数            print 模式要依次发送的消息
 */
export type HostMode = "interactive" | "print" | "rpc";

const MODES: readonly HostMode[] = ["interactive", "print", "rpc"];

export interface HostArgs {
    mode?: HostMode;
    session?: string;
    sessionDir?: string;
    /** 位置参数：print 模式下依次作为 prompt 发送。 */
    messages?: string[];
}

function isHostMode(value: string): value is HostMode {
    return (MODES as readonly string[]).includes(value);
}

export function parseHostArgs(argv: readonly string[]): HostArgs {
    const args: HostArgs = {};
    const messages: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === undefined) continue;
        if (!arg.startsWith("--")) {
            messages.push(arg);
            continue;
        }
        const value = argv[i + 1];
        if ((arg === "--session" || arg === "--session-dir" || arg === "--mode") && (value === undefined || value.startsWith("--"))) {
            throw new Error(`${arg} 需要一个值`);
        }
        if (arg === "--session") {
            args.session = value;
            i++;
        } else if (arg === "--session-dir") {
            args.sessionDir = value;
            i++;
        } else if (arg === "--mode") {
            if (value === undefined || !isHostMode(value)) {
                throw new Error(`--mode 只能是 ${MODES.join(" / ")}`);
            }
            args.mode = value;
            i++;
        } else {
            throw new Error(`未知参数：${arg}（支持 --mode、--session <path>、--session-dir <dir>）`);
        }
    }
    if (messages.length > 0) args.messages = messages;
    return args;
}
