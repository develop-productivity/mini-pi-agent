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

export type Message =
    | { role: "system"; content: string }
    | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
    | { role: "user"; content: string }
    | { role: "tool"; toolCallId: string; content: string; isError?: boolean }
export interface CompletionRequest {
    model: string;
    messages: Message[];
    tools?: ToolSpec[];
    signal?: AbortSignal;
}
export interface CompletionResponse {
    message: { role: "assistant"; content: string; toolCalls?: ToolCall[] };
    usage?: { inputTokens: number, outputTokens: number }
    stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";
}

export interface Api {
    name: string;
    complete(req: CompletionRequest) : Promise<CompletionResponse>;
    // 未实现：流式输出
    // stream(req: CompletionRequest) : AsyncIterable<StreamEvent>;
}
