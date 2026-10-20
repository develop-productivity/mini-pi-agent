import type { Api, CompletionRequest, CompletionResponse, Message, Tool, ToolCall } from "./types.ts";


export interface OpenAiConfig {
    name: string;
    baseURL: string;
    apiKey: string;
    headers?: Record<string, string>
};

interface OpenAiToolCall {
    id: string;
    type: "function" | string;
    function: {name: string; arguments: string}
}

export interface OpenAiResponse {
    choices: Array<{
        message: {
            role: string; content: string; tool_calls?: OpenAiToolCall[];
        };
        finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
    }>
    // 省略掉token usage
}

function toOpenAiMessages(messages: Message[]) {
    return messages.map((m) => {
       switch (m.role) {
        case "user": return m
        case "system": return m
        case "tool": {
            return {
                ...m,
                role: "tool",
                tool_call_id: m.toolCallId,
                content: m.isError ? `[ERROR] ${m.content}` : m.content
                }
        }
        case "assistant": {
            return {
                role: "assistant",
                content:m.content ?? "",
                ...(m.toolCalls?.length ? {tool_calls: m.toolCalls.map((tc:ToolCall) => ({
                    id:tc.id,
                    type: "function",
                    function: {name: tc.name, arguments: JSON.stringify(tc.arguments)}
                    }))}: {})
                }
            }
        }
    })
}

function mapStopReason(fr: OpenAiResponse["choices"][number]["finish_reason"]):CompletionResponse["stopReason"]{
    switch(fr) {
        case "stop": return "end_turn";
        case "length": return "max_tokens";
        case "tool_calls": return "tool_use";
        case "content_filter": return "stop_sequence";
        default:return "end_turn";
    }
}

function toOpenAiTools(tools: Tool[]): any[]  {
    return tools.map((tool) => ({type:"function", function:{name: tool.name, description: tool.description, parameters:tool.parameter}}))
}

function mapToolCall(tc: OpenAiToolCall): ToolCall {
    return {
        id: tc.id,
        name: tc.function.name,
        arguments:  JSON.parse(tc.function.arguments)
    }
}
function fromOpenAiResponse(response: OpenAiResponse): CompletionResponse {
    const choice = response.choices[0];
    if (!choice) throw new Error("OpenAI response has no choices");   // 极端情况
    //{"role":"assistant", "content":"...", "tool_calls":[{"id":"...", "type":"function", "function":{"name":"...", "arguments":"{...}"}}]}
    const msg = choice.message
    return {
        message: {role: "assistant", content: msg.content ?? "", ...(msg.tool_calls?.length ? {toolCalls:msg.tool_calls.map(mapToolCall)}: {})}
        // 省掉了stop reason的映射以及usage字段
    }
}

export function createOpenAiApi(config: OpenAiConfig): Api {
    return {
        name: config.name,
        async complete(req: CompletionRequest): Promise<CompletionResponse> {
            const body = {
                model: req.model, 
                messages: toOpenAiMessages(req.messages), 
                tools:req.tools?.length? toOpenAiTools(req.tools) : undefined, 
                stream: false
            }
            const res = await fetch(`${config.baseURL}/chat/completions`, {
                method:"POST", 
                headers: {"Authorization": `Bearer ${config.apiKey}`,"Content-Type": "application/json", ...(config.headers || {}),}, 
                body: JSON.stringify(body)})
            if (!res.ok) { throw new Error(`${config.name} ${res.status}: ${res.text()}`);}
            return fromOpenAiResponse(await res.json() as OpenAiResponse)
        }
    }
    
}