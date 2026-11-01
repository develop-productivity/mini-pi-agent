import type { TSchema } from "typebox";
import type {
    Api,
    CompletionRequest,
    CompletionResponse,
    Message,
    ToolCall,
    ToolSpec,
} from "./types.ts";

export interface OpenAiConfig {
    name: string;
    baseURL: string;
    apiKey: string;
    headers?: Record<string, string>;
}

interface OpenAiToolCall {
    id: string;
    type: "function" | string;
    function: { name: string; arguments: string };
}

interface OpenAiTool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: TSchema;
    };
}

type OpenAiMessage =
    | { role: "system" | "user"; content: string }
    | { role: "tool"; tool_call_id: string; content: string }
    | {
          role: "assistant";
          content: string;
          tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
          }>;
      };

export interface OpenAiResponse {
    choices: Array<{
        message: {
            role: string;
            content: string | null;
            tool_calls?: OpenAiToolCall[];
        };
        finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
    };
}

function toOpenAiMessages(messages: Message[]): OpenAiMessage[] {
    return messages.map((message) => {
        switch (message.role) {
            case "system":
            case "user":
                return { role: message.role, content: message.content };
            case "tool":
                return {
                    role: "tool",
                    tool_call_id: message.toolCallId,
                    content: message.isError ? `[ERROR] ${message.content}` : message.content,
                };
            case "assistant":
                return {
                    role: "assistant",
                    content: message.content,
                    ...(message.toolCalls?.length
                        ? {
                              tool_calls: message.toolCalls.map((toolCall) => ({
                                  id: toolCall.id,
                                  type: "function" as const,
                                  function: {
                                      name: toolCall.name,
                                      arguments: JSON.stringify(toolCall.arguments),
                                  },
                              })),
                          }
                        : {}),
                };
        }
    });
}

function mapStopReason(
    finishReason: OpenAiResponse["choices"][number]["finish_reason"],
): NonNullable<CompletionResponse["stopReason"]> {
    switch (finishReason) {
        case "stop":
            return "end_turn";
        case "length":
            return "max_tokens";
        case "tool_calls":
            return "tool_use";
        case "content_filter":
            return "stop_sequence";
        default:
            return "end_turn";
    }
}

function toOpenAiTools(tools: ToolSpec[]): OpenAiTool[] {
    return tools.map((tool) => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}

function mapToolCall(toolCall: OpenAiToolCall): ToolCall {
    return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
    };
}

function fromOpenAiResponse(response: OpenAiResponse): CompletionResponse {
    const choice = response.choices[0];
    if (!choice) throw new Error("OpenAI response has no choices");

    return {
        message: {
            role: "assistant",
            content: choice.message.content ?? "",
            ...(choice.message.tool_calls?.length
                ? { toolCalls: choice.message.tool_calls.map(mapToolCall) }
                : {}),
        },
        stopReason: mapStopReason(choice.finish_reason),
        ...(response.usage
            ? {
                  usage: {
                      inputTokens: response.usage.prompt_tokens,
                      outputTokens: response.usage.completion_tokens,
                  },
              }
            : {}),
    };
}

export function createOpenAiApi(config: OpenAiConfig): Api {
    return {
        name: config.name,
        async complete(request: CompletionRequest): Promise<CompletionResponse> {
            const body = {
                model: request.model,
                messages: toOpenAiMessages(request.messages),
                tools: request.tools?.length ? toOpenAiTools(request.tools) : undefined,
                stream: false,
            };
            const baseURL = config.baseURL.replace(/\/$/, "");
            const response = await fetch(`${baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    "Content-Type": "application/json",
                    ...(config.headers ?? {}),
                },
                body: JSON.stringify(body),
                signal: request.signal,
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(
                    `${config.name} ${response.status}: ${errorBody || response.statusText}`,
                );
            }

            return fromOpenAiResponse((await response.json()) as OpenAiResponse);
        },
    };
}
