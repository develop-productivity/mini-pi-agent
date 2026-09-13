import type { TSchema } from "typebox";
import readline from "readline";
import { writeFile, readFile } from "node:fs/promises"
import type { Tool, toolCall, Message, CompletionRequest, CompletionResponse } from "./provider/types.ts"

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

// mock：不连网络，靠"历史里已经有几条 assistant 消息"来决定这一轮该说什么。
// 为什么不用一个模块级的计数器：因为那样会记住"上一次对话"的状态——
// 现在 main() 里的对话历史是持续累积的，一次程序运行里可能问好几个问题，
// 用计数器的话，第二个问题会从第一个问题遗留的计数接着往下走，而不是正确地
// 只看"这次对话里已经有几条 assistant 消息"。从 req.messages 里现数，就没有这个问题。
async function callLLM(req: CompletionRequest): Promise<CompletionResponse> {
    const assistantTurns = req.messages.filter((m) => m.role === "assistant").length;

    if (assistantTurns === 0) {
        // 第一轮：假装要调用一个工具
        return {
            message: {
                role: "assistant",
                content: "Let me check the current time for you.",
                toolCalls: [{ id: "call_1", name: "get_current_time", arguments: { timezone: "UTC" } }],
            },
            stopReason: "tool_use",
        };
    }

    // 第二轮：工具结果已经在 req.messages 里了，假装看过之后给出最终答案
    return {
        message: {
            role: "assistant",
            content: "The current time has been retrieved. Anything else I can help with?",
        },
        stopReason: "end_turn",
    };
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
    let hasMoreToolCalls = true;
    while (hasMoreToolCalls) {
        const response: CompletionResponse = await callLLM({
            model: "mock-1",
            messages: runMessages,
            tools: Tools
        })
        if (response.message.content.trim()) {console.log(`Assistant: ${response.message.content}`)}
        runMessages.push(response.message)

        const toolCalls = response.message.toolCalls || []
        if (toolCalls.length === 0) {
            hasMoreToolCalls = false
        } else {
            for (const tc of toolCalls) {
                let result: string;
                try {
                    result = await executeTool(tc.name, tc.arguments)
                } catch (err) {
                    result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
                }
                runMessages.push({role:"tool", toolCallId: tc.id, content: result})
            }
        }
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
        if (!prompt || prompt === "exit") {
            process.exit(0)
        }
        messages.push({ role: "user", content: prompt });
        await agentLoop(messages);
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
