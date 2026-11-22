import { type StreamFn, type AgentTool, type AgentOptions, type AgentListenerErrorHandler } from "@mini-pi/agent"
import { type ApiConfig, createApi } from "@mini-pi/ai"
import { CodingAgentSession, createCodingAgentSession, type CodingAgentSessionOptions} from "./coding-agent-session.ts"
import { createBuiltinTools } from "../tools/builtin.ts"


export interface CreateSessionOptions {
    model: string;              // 必填：SDK 不替调用方选模型
    streamFn?: StreamFn;        // 与 api 二选一：直接给流式函数
    api?: ApiConfig;            // 与 streamFn 二选一：给 provider 配置，由 SDK 创建
    tools?: AgentTool[];        // 默认 createBuiltinTools({ cwd })
    cwd?: string;               // 默认 process.cwd()
    sessionPath: string;        // 必填：SDK 不决定文件写在哪（父目录不存在时由 SessionStorage 创建）
    onListenerError?: AgentListenerErrorHandler; // 可选：监听器抛错时的回调，原样交给 Agent
}

export interface CreateSessionResult {
    session: CodingAgentSession;
    // 预留：创建过程中的非致命诊断。参考 pi，SDK 不打印、不退出，交给调用方决定
}

/**
 * 对外唯一的组装入口（参考 pi 的 createAgentSession）。
 * 只用显式参数，不读环境变量：streamFn 和 api 都没给时直接报错。
 */
export async function createSession(options: CreateSessionOptions): Promise<CreateSessionResult> {
    const cwd = options.cwd ?? process.cwd();
    const tools = options.tools ?? createBuiltinTools({ cwd });
    let streamFn: StreamFn;
    if (options.streamFn) {
        streamFn = options.streamFn; // 优先用传进来的streamFn
    } else if (options.api) {
        const api = createApi(options.api);          // 这里 options.api 一定有值，不会触发默认参数
        streamFn = (request) => api.stream(request);
    } else {
        throw new Error("createSession: 必须提供 streamFn 或 api");
    }
    const agentOptions: AgentOptions = {
        tools: tools,
        streamFn: streamFn ,
        initialState: {model: options.model},
        onListenerError: options.onListenerError,
    }
    const codingAgentSessionOptions: CodingAgentSessionOptions = {
        sessionPath:options.sessionPath,
        cwd: cwd,
    }
    return {
        session: await createCodingAgentSession(agentOptions, codingAgentSessionOptions)
    }
}
