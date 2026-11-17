/**
 * agent loop
 *
 * 只依赖注入进来的抽象：StreamFn（模型）、ToolRegistry（工具）、emit（事件）。
 * 不持有状态：Agent 的历史由 Agent 在 processEvents 里根据 message_end 维护，
 * loop 只在自己的上下文拷贝上追加消息，并为每条进入上下文的消息发出事件。
 */
import type {
    Message,
    CompletionResponse,
    CompletionRequest,
    ToolSpec,
} from "@mini-pi/ai";

import type { StreamFn, AgentLoopConfig, AgentLoopContext } from "./types.ts";
import type { AgentEvent } from "./event.ts";
import { executeTool } from "../tools/executor.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

type AssistantMessage = CompletionResponse["message"];

/** 把 provider 的流式事件翻译成 message_start / update / end，并返回最终消息。 */
export async function streamAssistantResponse(
    streamFn: StreamFn,
    request: CompletionRequest,
    emit: AgentEventSink,
): Promise<CompletionResponse> {
    // StreamEvent 没有 start 事件，所以在读流之前发 message_start：
    // 模型一个字不输出、直接给 tool call 时，UI 也能收到完整的 start/end。
    let partial: AssistantMessage = { role: "assistant", content: "" };
    await emit({ type: "message_start", message: partial });

    let done: CompletionResponse | undefined;
    for await (const ev of streamFn(request)) {
        if (ev.type === "text_delta") {
            // 每次新建对象：监听器可能持有上一次的引用，原地修改会改掉它们的快照。
            partial = { ...partial, content: partial.content + ev.delta };
            await emit({ type: "message_update", message: partial, delta: ev.delta });
        } else if (ev.type === "done") {
            // 完整消息（含 toolCalls）以 provider 收尾时给的为准，不用自己拼的 partial。
            done = { message: ev.message, usage: ev.usage, stopReason: ev.stopReason };
        }
        // tool_use_* 先忽略：done 会带上完整的 toolCalls。
    }

    if (!done) {
        throw new Error("model stream ended without a done event");
    }
    await emit({ type: "message_end", message: done.message });
    return done;
}

/** 一条消息进入上下文：发 start/end（Agent 在 end 时写入历史），再追加到本次上下文。 */
async function appendMessage(
    messages: Message[],
    message: Message,
    emit: AgentEventSink,
): Promise<void> {
    await emit({ type: "message_start", message });
    await emit({ type: "message_end", message });
    messages.push(message);
}

function toToolSpecs(context: AgentLoopContext): ToolSpec[] {
    // 只把模型需要看的字段发出去，execute 留在本地。
    return context.tools.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
    }));
}

function buildRequest(
    context: AgentLoopContext,
    config: AgentLoopConfig,
    messages: Message[],
    signal: AbortSignal,
): CompletionRequest {
    const system: Message[] = context.systemPrompt
        ? [{ role: "system", content: context.systemPrompt }]
        : [];
    return {
        model: config.model,
        messages: [...system, ...messages],
        tools: toToolSpecs(context),
        signal,
    };
}

async function agentLoop(
    prompts: Message[],
    agentLoopContext: AgentLoopContext,
    agentLoopConfig: AgentLoopConfig,
    emit: AgentEventSink,
    signal: AbortSignal,
): Promise<void> {
    // context.messages 已经是 Agent 给的拷贝，可以直接追加。
    const runMessages = agentLoopContext.messages;
    // 本次输入先当成"待注入"的消息，和 steering / follow-up 走同一条路径。
    let pending: Message[] = prompts;
    let turnCount = 0;

    // 外层：模型本来要停下时，有 follow-up 就继续。
    while (true) {
        let hasMoreToolCalls = true;
        // 内层：有 tool call 或有待注入的消息就继续。
        while (hasMoreToolCalls || pending.length > 0) {
            for (const message of pending) {
                await appendMessage(runMessages, message, emit);
            }
            pending = [];

            turnCount++;
            await emit({ type: "turn_start", turn: turnCount });

            const response = await streamAssistantResponse(
                agentLoopConfig.streamFn,
                buildRequest(agentLoopContext, agentLoopConfig, runMessages, signal),
                emit,
            );
            runMessages.push(response.message);

            const toolCalls = response.message.toolCalls ?? [];
            hasMoreToolCalls = toolCalls.length > 0;

            const toolResults: Message[] = [];
            for (const tc of toolCalls) {
                await emit({
                    type: "tool_execution_start",
                    toolCallId: tc.id,
                    toolName: tc.name,
                    args: tc.arguments,
                });
                // executeTool 已经把未知工具、参数错误和执行异常都转成了 "ERROR: ..." 文本。
                const result = await executeTool(agentLoopConfig.toolRegistry, tc.name, tc.arguments, {
                    signal,
                    onProgress: (chunk) =>
                        emit({
                            type: "tool_execution_update",
                            toolCallId: tc.id,
                            toolName: tc.name,
                            partialResult: chunk,
                        }),
                });
                const isError = result.startsWith("ERROR:");
                await emit({
                    type: "tool_execution_end",
                    toolCallId: tc.id,
                    toolName: tc.name,
                    result,
                    isError,
                });

                const toolMessage: Message = { role: "tool", toolCallId: tc.id, content: result, isError };
                await appendMessage(runMessages, toolMessage, emit);
                toolResults.push(toolMessage);
            }

            await emit({ type: "turn_end", turn: turnCount, message: response.message, toolResults });

            // 时机 ①：一轮的工具全部执行完之后才注入 steering，
            // 保证每个 tool call 后面紧跟它的 tool result。
            pending = (await agentLoopConfig.getSteeringMessages?.()) ?? [];
        }

        // 时机 ②：只有 agent 本来要停下时才看 follow-up。
        const followUps = (await agentLoopConfig.getFollowUpMessages?.()) ?? [];
        if (followUps.length === 0) break;
        pending = followUps;
    }
}

export async function runAgentLoop(
    prompts: Message[],
    agentLoopContext: AgentLoopContext,
    agentLoopConfig: AgentLoopConfig,
    emit: AgentEventSink,
    signal: AbortSignal,
): Promise<void> {
    const runId = crypto.randomUUID();
    await emit({ type: "agent_start", runId });
    await agentLoop(prompts, agentLoopContext, agentLoopConfig, emit, signal);
    await emit({ type: "agent_end", runId, messages: agentLoopContext.messages });
}
