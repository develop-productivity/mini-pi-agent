import type { TSchema } from "typebox";

/** The model-facing description of a tool. It contains no executable code. */
export interface ToolSpec {
    name: string;
    description: string;
    parameters: TSchema;
}
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

// agent 内部统一用的形状，跟外部 API（DeepSeek/OpenAI/mock）长什么样完全无关。

/**
 * 模型为什么停下。"error" / "aborted" 不是模型给的，是调用失败或被中止时由我们写入的：
 * 失败也编码成一条 assistant 消息，而不是抛异常（参考 pi）。
 */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error" | "aborted";

export interface AssistantMessage {
    role: "assistant";
    content: string;
    toolCalls?: ToolCall[];
    /** 可选：旧的 session JSONL 和手写的历史消息里没有这个字段。 */
    stopReason?: StopReason;
    /** stopReason 为 "error" / "aborted" 时的说明。 */
    errorMessage?: string;
}

export type Message =
    | { role: "system"; content: string }
    | AssistantMessage
    | { role: "user"; content: string }
    | { role: "tool"; toolCallId: string; content: string; isError?: boolean }

export interface CompletionRequest {
    model: string;
    messages: Message[];
    tools?: ToolSpec[];
    signal?: AbortSignal;
}
export interface CompletionResponse {
    message: AssistantMessage;
    usage?: { inputTokens: number, outputTokens: number }
    stopReason?: StopReason;
}

export interface Api {
    name: string;
    complete(req: CompletionRequest) : Promise<CompletionResponse>;
    // 未实现：流式输出
    stream(req: CompletionRequest) : AsyncIterable<StreamEvent>;
}


export type StreamEvent =
    | { type: "start"; message: AssistantMessage }
    | { type: "text_delta"; delta: string }
    | { type: "tool_use_start"; index: number; id: string; name: string }
    | { type: "tool_use_delta"; index: number; deltaJson: string }
    | { type: "tool_use_end"; index: number; id: string; name: string; arguments: Record<string, unknown> }
    | { type: "done";
        message: CompletionResponse["message"];
        stopReason: CompletionResponse["stopReason"];
        usage?: CompletionResponse["usage"] }
    | { type: "error";
        message: AssistantMessage;
        stopReason: "error" | "aborted";
        usage?: CompletionResponse["usage"] };
