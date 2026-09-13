import type { TSchema } from "typebox";

// agent 内部统一用的形状，跟外部 API（DeepSeek/OpenAI/mock）长什么样完全无关。
// agent_med.ts 和 agent_mock.ts 共用这一份，避免两处各自维护一份重复的定义。

export interface Tool {
    name: string;
    description: string;
    parameter: TSchema
}
export interface toolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>
}
export type Message =
    | { role: "system"; content: string }
    | { role: "assistant"; content: string; toolCalls?: toolCall[] }
    | { role: "user"; content: string }
    | { role: "tool"; toolCallId: string; content: string; isError?: boolean }
export interface CompletionRequest {
    model: string;
    messages: Message[];
    tools?: Tool[];
    signal?: AbortController['signal']
}
export interface CompletionResponse {
    message: { role: "assistant"; content: string; toolCalls?: toolCall[] };
    usage?: { inputTokens: number, outputTokens: number }
    stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";
}
