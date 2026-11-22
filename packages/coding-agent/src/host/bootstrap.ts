/**
 * bootstrap：有副作用的组装入口。
 * 读环境变量 → 决定 provider / model / session 文件 → 组装 streamFn 和工具 → 创建 Session。
 * CLI 和以后的 TUI 共用这一份，Host 自己只管输入输出。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApi } from "@mini-pi/ai";
import { createBuiltinTools } from "../tools/builtin.ts";
import { createCodingAgentSession, type CodingAgentSession } from "../runtime/coding-agent-session.ts";
import type { HostOptions } from "./types.ts";
import { dirname } from "node:path";

/** 没设 MODEL 时的默认模型。只给能确定模型名的 provider 设默认值，其他的必须显式指定。 */
const DEFAULT_MODELS: Record<string, string> = {
    mock: "mock",
    deepseek: "deepseek-v4",
};

export function resolveHostOptions(
    sessionName: string,
    env: NodeJS.ProcessEnv = process.env,
    cwd: string = process.cwd(),
): HostOptions {
    // 和 createApi() 的默认值保持一致
    const provider = env.PROVIDER || "openai";
    const model = env.MODEL || DEFAULT_MODELS[provider];
    if (!model) {
        throw new Error(`PROVIDER=${provider} 没有默认模型，请设置 MODEL 环境变量`);
    }
    const sessionDir = join(cwd, ".sessions");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sessionFile = sessionName ?? join(sessionDir, `${stamp}.jsonl`)
    return { cwd, provider, model, sessionPath: sessionFile};
}

export async function createHostSession(options: HostOptions): Promise<CodingAgentSession> {
    mkdirSync(dirname(options.sessionPath), { recursive: true });

    const api = createApi();
    return createCodingAgentSession(
        {
            streamFn: (request) => api.stream(request),
            tools: createBuiltinTools({ cwd: options.cwd }),
            initialState: { model: options.model },
            onListenerError: (error, event) => {
                process.stderr.write(`[listener error on ${event.type}] ${String(error)}\n`);
            },
        },
        { sessionPath: options.sessionPath, cwd: options.cwd },
    );
}
