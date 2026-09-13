import type { TSchema } from "typebox";
import readline from "readline";
import { writeFile, readFile } from "node:fs/promises"

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
        // 省略掉其他的，比如 finish_reason
    }>
    // 省略掉token usage
}

const Tools: Tool[] = [
    {
        name: "read_file", 
        description: "Read the content of a file", 
        parameter: {type: "object", properties: {file_path: {type: "string"}}, required: ["file_path"]} as TSchema
    },
    {
        name: "write_file", 
        description: "Write content to a file", 
        parameter: {type: "object", properties: {file_path: {type: "string"}, content: {type: "string"}},required: ["file_path", "content"]} as TSchema
    },
    {
        name:"get_current_time",
        description: "Get the current time", 
        parameter: {type: "object", properties: {timezone: {type: "string"}}, required: ["timezone"]} as TSchema
    }
]

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
                ...(m.toolCalls?.length ? {tool_calls: m.toolCalls.map((tc:toolCall) => ({
                    id:tc.id,
                    type: "function",
                    function: {name: tc.name, arguments: JSON.stringify(tc.arguments)}
                    }))}: {})
                }
            }
        }
    })
}

function toOpenAiTools(tools: Tool[]): any[]  {
    return tools.map((tool) => ({type:"function", function:{name: tool.name, description: tool.description, parameters:tool.parameter}}))
}

function mapToolCall(tc: OpenAiToolCall): toolCall {
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

export async function callLLM(req: CompletionRequest): Promise<CompletionResponse> {
    const body = {model: req.model, messages: toOpenAiMessages(req.messages), tools:req.tools?.length? toOpenAiTools(req.tools) : undefined, stream: false}
    const res = await fetch("https://api.deepseek.com/chat/completions", {method:"POST", headers: {"Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,"Content-Type": "application/json"}, body: JSON.stringify(body)})
    const text = await res.text();
    if (!res.ok) { throw new Error(`DeepSeek ${res.status}: ${text}`);}
    const response = fromOpenAiResponse(JSON.parse(text) as OpenAiResponse)
    return response
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = Tools.find(t => t.name === name);
    if (!tool) {throw new Error(`Tool not found: ${name}`);}
    console.log(`tool -> ${name}: ${JSON.stringify(args)}`)
    if (name === "read_file") {
        const { file_path } = args;
        if (typeof file_path !== "string") {throw new Error("Invalid argument for read_file: file_path must be a string");}
        const content = await readFile(file_path, "utf-8");
        return content;
    } else if (name === "write_file") {
        const { file_path, content } = args;
        if (typeof file_path !== "string" || typeof content !== "string") {throw new Error("Invalid arguments for write_file: file_path and content must be strings");}
        await writeFile(file_path, content);
        return "File written successfully";
    } else if (name === "get_current_time") {
        const { timezone } = args;
        if (typeof timezone !== "string") {throw new Error("Invalid argument for get_current_time: timezone must be a string");}
        const date = new Date();
        return date.toLocaleString("en-US", { timeZone: timezone });
    } else {
        return `Unknown tool: ${name}`;
    }
}

async function agentLoop(runMessages: Message[]): Promise<void> {
    let turnCount: number = 0;
    while(true) {
        let hasMoreToolCalls = true;
        while(hasMoreToolCalls) {
            turnCount ++;
            const response: CompletionResponse = await callLLM({
                model: "deepseek-flash",
                messages: runMessages,
                tools: Tools
            })
            if (response.message.content.trim()) {console.log(`Assistant: ${response.message.content}`)}
            runMessages.push(response.message)

            const toolCalls = response.message.toolCalls || []
            if (toolCalls.length === 0) {hasMoreToolCalls = false}
            else {
                hasMoreToolCalls = true;
                if(toolCalls.length > 0) {
                    for(const tc of toolCalls) {
                        let result: string;
                        try {
                            result = await executeTool(tc.name, tc.arguments)
                        } catch(err) {result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;}
                        runMessages.push({role:"tool",toolCallId: tc.id,content: result,})
                    }
                }
            }
        }
        break
    }
    
}

async function main(): Promise<void> {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    rl.on("SIGINT", () => {
        rl.close();
        process.exit(0);
    });
    const messages: Message[] = [{role:"system", content:`You are a helpful assistant`}]
    while (true) {
        const prompt = await new Promise<string>((r) => rl.question("User: ", r));
        if(!prompt || prompt === "exit") {
            process.exit(0)
        }
        messages.push({ role: "user", content: prompt });   // 新一轮，往同一个数组里追加
        await agentLoop(messages);
    }
}

main().catch((err) => { console.error(err);process.exit(1); });