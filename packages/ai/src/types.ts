import type { TSchema } from "typebox";

export interface Tool {
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
// agent_med.ts 和 agent_mock.ts 共用这一份，避免两处各自维护一份重复的定义。

export type Message =
    | { role: "system"; content: string }
    | { role: "assistant"; content: string; ToolCalls?: ToolCall[] }
    | { role: "user"; content: string }
    | { role: "tool"; ToolCallId: string; content: string; isError?: boolean }
export interface CompletionRequest {
    model: string;
    messages: Message[];
    tools?: Tool[];
    signal?: AbortController['signal']
}
export interface CompletionResponse {
    message: { role: "assistant"; content: string; ToolCalls?: ToolCall[] };
    usage?: { inputTokens: number, outputTokens: number }
    stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";
}

export interface Api {
    name: string;
    complete(req: CompletionRequest) : Promise<CompletionResponse>;
    // stream(req: CompletionRequest) : AsyncIterable<StreamEvent>;
}