import type { TSchema } from "typebox";
import { iterateSse } from "./sse.ts"
import type {
    Api,
    CompletionRequest,
    CompletionResponse,
    Message,
    ToolCall,
    ToolSpec,
    StreamEvent,
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
            stopReason: mapStopReason(choice.finish_reason),
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
        async *stream(req: CompletionRequest) : AsyncIterable<StreamEvent> {
            const body = {
                model: req.model,
                messages: toOpenAiMessages(req.messages),
                tools: req.tools?.length? toOpenAiTools(req.tools) : undefined,
                stream: true,
                stream_options: { include_usage: true }

            }
            const res = await fetch(`${config.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${config.apiKey}`,
                    "Content-Type": "application/json",
                    ...(config.headers || {}),

                },
                body: JSON.stringify(body),
                signal: req.signal
            })
            if (!res.ok) throw new Error(`${config.name} ${res.status}: ${await res.text()}`);
            if (!res.body) throw new Error(`${config.name}: no body`);
            // 状态
            let accumulatedText = "";
            const toolCallsByIndex = new Map<number, {
                id: string;
                name: string;
                partialJson: string;
            }>();
            let stopReason: CompletionResponse["stopReason"] = "end_turn";
            let usage: CompletionResponse["usage"] | undefined;

            for await (const sse of iterateSse(res.body, req.signal)) {
                if (sse.data === "[DONE]") break;
                const chunk = JSON.parse(sse.data) as any;
                // usage 事件(choices 为空,usage 字段独立)
                if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
                    usage = {
                        inputTokens: chunk.usage.prompt_tokens ?? 0,
                        outputTokens: chunk.usage.completion_tokens ?? 0
                    }
                    continue
                }
                const choice = chunk.choices?.[0];
                if (!choice) continue
                const delta = choice.delta ?? {}
                // text_delta
                if (typeof delta.content === "string" && delta.content.length > 0) {
                    accumulatedText += delta.content
                    yield {type: "text_delta", delta: delta.content}
                }
                // tool_calls_delta
                if (Array.isArray(delta.tool_calls)) {
                    for (const tcDelta of delta.tool_calls) {
                        const idx = tcDelta.index
                        let exiting = toolCallsByIndex.get(idx);
                        // 第一次见这idx
                        if (!exiting) {
                            exiting = {id: tcDelta.id ?? "", name: tcDelta.function.name, partialJson: ""};
                            toolCallsByIndex.set(idx, exiting);
                            yield {type: "tool_use_start", index:idx, id:exiting.id, name: exiting.name}
                        }
                        // 累计argments
                        const argsFragment = tcDelta.function?.arguments;
                        if (typeof argsFragment === "string" && argsFragment.length > 0 ){
                            exiting.partialJson += argsFragment
                            yield {type: "tool_use_delta", index:idx,  deltaJson: argsFragment}
                        }
                    }
                }
                // finish_reason
                if (choice.finish_reason) {
                    stopReason = mapStopReason(choice.finish_reason);   // ← 翻译一次,存翻译后的
                    // finish 把所有累计的tool calls 收尾，parse json + yield too_use_end
                    for (const [idx, tc] of toolCallsByIndex){
                        let args : Record<string, unknown> = {}
                        try {
                            args = tc.partialJson ? JSON.parse(`${tc.partialJson}`) : {}
                        } catch {}
                        yield {type: "tool_use_end", index:idx, id:tc.id, name: tc.name, arguments: args}
                    }
                }
            }
            // 拼最终的message
            const toolCalls : ToolCall[] = []
            for (const [, tc] of toolCallsByIndex) {
                let args : Record<string, unknown> = {}
                try {
                    args = tc.partialJson ? JSON.parse(`${tc.partialJson}`) : {}
                } catch {}
                toolCalls.push({id: tc.id, name: tc.name, arguments: args})
            }
            // yield done
            yield {
                type: "done",
                message: { role: "assistant", content: accumulatedText, ...(toolCalls.length ? { toolCalls } : {}), stopReason },
                stopReason: stopReason,
                usage
            }
        }
    };
}
