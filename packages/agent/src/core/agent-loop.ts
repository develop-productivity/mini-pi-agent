/**
 * agent loop
 */
import { 
    type Message,
    type CompletionResponse,
    type CompletionRequest,
    createApi
} from "@mini-pi/ai";

import { type StreamFn } from "./types.ts"
import { executeTool } from "../tools/executor.ts"
import { ToolRegistry } from "../tools/registry.ts"

export async function streamAssistantResponse(
    streamFn: StreamFn,
    request: CompletionRequest
): Promise<CompletionResponse> {
    let finalMessage: CompletionResponse['message'] = { role: "assistant", content: "" };
    let usage : CompletionResponse['usage'] = undefined;
    let stopReason: CompletionResponse['stopReason'] = "error"
    for await (const ev of streamFn(request)) {
        if (ev.type === "text_delta") {
            
        } else if (ev.type === "done") {
            
        }
    }
    return { message: finalMessage, usage, stopReason }
}

async function agentLoop(
    runMessages: Message[], 
    registry: ToolRegistry,
    streamFn: StreamFn,
    signal?: AbortSignal
): Promise<void> {
    let turnCount: number = 0;
    while(true) {
        let hasMoreToolCalls = true;
        while(hasMoreToolCalls) {
            turnCount ++;
            const response: CompletionResponse = await streamAssistantResponse(streamFn, {
                model: "deepseek",
                messages: runMessages,
                signal: signal
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
                            result = await executeTool(registry, tc.name, tc.arguments, {signal:signal?? new AbortSignal})
                        } catch(err) {result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;}
                        runMessages.push({role:"tool",toolCallId: tc.id,content: result,})
                    }
                }
            }
        }
        break
    }
    
}

export async function runAgentLoop(
    prompts: Message[],
    toolRegistry: ToolRegistry,
    streamFn: StreamFn,
    signal?: AbortSignal
): Promise<Message>{
    while (true) {
        await agentLoop(prompts, toolRegistry, streamFn, signal);
    }
}

