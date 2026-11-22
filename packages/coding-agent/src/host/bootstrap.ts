/**
 * bootstrap：Host 层的入口适配（对应 pi 的 main.ts）。
 * 只负责把命令行参数和环境变量转成显式参数：provider / model / session 文件 → 调用 SDK 的 createSession()。
 * 真正的组装（streamFn、工具、Agent、SessionStorage）在 runtime/sdk.ts。
 */
import { join, resolve } from "node:path";
import { apiConfigFromEnv } from "@mini-pi/ai";
import { createSession } from "../runtime/sdk.ts";
import type { CodingAgentSession } from "../runtime/coding-agent-session.ts";
import type { HostOptions } from "./types.ts";
import type { HostArgs } from "./args.ts";

/** 没设 MODEL 时的默认模型。只给能确定模型名的 provider 设默认值，其他的必须显式指定。 */
const DEFAULT_MODELS: Record<string, string> = {
    mock: "mock",
    deepseek: "deepseek-v4",
};

/** 环境变量：session 文件存放目录（对应 pi 的 PI_CODING_AGENT_SESSION_DIR），被 --session-dir 覆盖。 */
export const ENV_SESSION_DIR = "MINI_PI_SESSION_DIR";

/**
 * 把命令行参数和环境变量解析成一份 HostOptions（对应 pi 的 main.ts 里解析参数、模型的部分）。
 * provider 配置在这里解析一次，之后显示和连接都用 options.api。
 *
 * session 文件的优先级：--session <path> > --session-dir <dir> > $MINI_PI_SESSION_DIR > <cwd>/.sessions
 */
export function resolveHostOptions(
    args: HostArgs = {},
    env: NodeJS.ProcessEnv = process.env,
    cwd: string = process.cwd(),
): HostOptions {
    const api = apiConfigFromEnv(env);
    const model = env.MODEL || DEFAULT_MODELS[api.provider];
    if (!model) {
        throw new Error(`PROVIDER=${api.provider} 没有默认模型，请设置 MODEL 环境变量`);
    }
    const sessionDir = resolve(cwd, args.sessionDir ?? (env[ENV_SESSION_DIR] || ".sessions"));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sessionPath = args.session ? resolve(cwd, args.session) : join(sessionDir, `${stamp}.jsonl`);
    return { cwd, api, model, sessionPath };
}

export async function createHostSession(options: HostOptions): Promise<CodingAgentSession> {
    // 环境变量已经在 resolveHostOptions 里解析过；SDK 只接收显式参数
    const { session } = await createSession({
        model: options.model,
        api: options.api,
        cwd: options.cwd,
        sessionPath: options.sessionPath,
        onListenerError: (error, event) => {
            process.stderr.write(`[listener error on ${event.type}] ${String(error)}\n`);
        },
    });
    return session;
}
