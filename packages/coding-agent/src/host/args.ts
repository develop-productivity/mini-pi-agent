/**
 * Host 的命令行参数（参考 pi 的 cli/args.ts，只保留 session 相关的两个）。
 *
 *   --session <path>       直接打开 / 创建这个 session 文件（优先级最高）
 *   --session-dir <dir>    session 文件存放目录，覆盖环境变量 MINI_PI_SESSION_DIR
 */
export interface HostArgs {
    session?: string;
    sessionDir?: string;
}

export function parseHostArgs(argv: readonly string[]): HostArgs {
    const args: HostArgs = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = argv[i + 1];
        if ((arg === "--session" || arg === "--session-dir") && (value === undefined || value.startsWith("--"))) {
            throw new Error(`${arg} 需要一个值`);
        }
        if (arg === "--session") {
            args.session = value;
            i++;
        } else if (arg === "--session-dir") {
            args.sessionDir = value;
            i++;
        } else {
            throw new Error(`未知参数：${arg}（支持 --session <path>、--session-dir <dir>）`);
        }
    }
    return args;
}
