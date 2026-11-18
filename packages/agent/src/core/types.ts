import type { Static, TSchema } from "typebox";
import type { ToolSpec, CompletionRequest, StreamEvent, Api,Message } from "@mini-pi/ai";
import { type ToolRegistry } from "../tools/registry.ts";

export type ToolProgressStream = "stdout" | "stderr";

export interface ToolContext {
    signal: AbortSignal;
    /** Incremental output produced while a tool is running. */
    onProgress?: (chunk: string, stream?: ToolProgressStream) => void | Promise<void>;
}

/** A model-facing tool specification plus its executable implementation. */
export interface AgentTool<S extends TSchema = TSchema> extends ToolSpec {
    parameters: S;
    execute(args: Static<S>, ctx: ToolContext): Promise<string>;
}

export function defineTool<S extends TSchema>(tool: AgentTool<S>): AgentTool<S> {
    return tool;
}


export interface AgentLoopConfig {
    model: string;
    streamFn: StreamFn;
    toolRegistry: ToolRegistry;
    getSteeringMessages?: () => Promise<Message[]>;
    getFollowUpMessages?: () => Promise<Message[]>;
}

/** Agent 对外的只读状态快照，由 processEvents 根据事件维护。 */
export interface AgentState {
    model:string
    messages: Message[];
    /** 正在流式输出的那条消息；不在输出时为 undefined。 */
    streamingMessage?: Message;
    /** 正在执行的 toolCallId。 */
    pendingToolCalls: ReadonlySet<string>;
    isRunning: boolean;
    errorMessage?:string
}
export interface AgentLoopContext {
    systemPrompt?: string;   // 可选，以后再用；发请求时拼在最前面
    messages: Message[];     // 本次运行开始前的历史（拷贝）
    tools: AgentTool[];      // 本次运行开始时的工具快照，用来告诉模型有哪些工具
}

export type StreamFn = (
    request: CompletionRequest,
) => AsyncIterable<StreamEvent>;

export interface NextTurnUpdate {
    model?: string;
    // messages?: Message[];   ← 等做上下文压缩时再加
}
// AgentLoopConfig 里加：
// prepareNextTurn?: (signal: AbortSignal) => Promise<NextTurnUpdate | undefined>;
