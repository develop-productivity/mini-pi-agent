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
    ToolCall,
} from "@mini-pi/ai";

import type { StreamFn, AgentLoopConfig, AgentLoopContext } from "./types.ts";
import type { AgentEvent } from "./event.ts";
import { executeTool } from "../tools/executor.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

type AssistantMessage = CompletionResponse["message"];

interface PartialToolCall {
    id: string;
    name: string;
    partialJson: string;
    arguments?: Record<string, unknown>;
}

/** 把 provider 的流式事件翻译成 message_start / update / end，并返回最终消息。 */
export async function streamAssistantResponse(
    streamFn: StreamFn,
    request: CompletionRequest,
    emit: AgentEventSink,
): Promise<CompletionResponse> {
    let partial: AssistantMessage = { role: "assistant", content: "" };
    let started = false;
    let done: CompletionResponse | undefined;
    const partialToolCalls = new Map<number, PartialToolCall>();

    const snapshotToolCalls = (): ToolCall[] =>
        Array.from(partialToolCalls.entries())
            .sort(([a], [b]) => a - b)
            .map(([, toolCall]) => ({
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments ?? {},
            }));

    const updatePartial = (): AssistantMessage => {
        const toolCalls = snapshotToolCalls();
        partial = { ...partial, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
        return partial;
    };

    const ensureStarted = async (message: AssistantMessage = partial): Promise<void> => {
        if (started) return;
        started = true;
        await emit({ type: "message_start", message: { ...message } });
    };

    const fail = async (error: unknown): Promise<CompletionResponse> => {
        const aborted = request.signal?.aborted === true;
        const finalMessage: AssistantMessage = {
            ...updatePartial(),
            stopReason: aborted ? "aborted" : "error",
            errorMessage: aborted
                ? "Request aborted"
                : error instanceof Error
                  ? error.message
                  : String(error),
        };
        await ensureStarted(finalMessage);
        await emit({ type: "message_end", message: finalMessage });
        return { message: finalMessage, stopReason: finalMessage.stopReason };
    };

    try {
        for await (const event of streamFn(request)) {
            switch (event.type) {
                case "start":
                    partial = event.message;
                    await ensureStarted(partial);
                    break;

                case "text_delta":
                    partial = { ...partial, content: partial.content + event.delta };
                    await ensureStarted();
                    await emit({ type: "message_update", message: partial, delta: event.delta });
                    break;

                case "tool_use_start":
                    partialToolCalls.set(event.index, {
                        id: event.id,
                        name: event.name,
                        partialJson: "",
                    });
                    await ensureStarted();
                    await emit({ type: "message_update", message: updatePartial() });
                    break;

                case "tool_use_delta": {
                    const toolCall = partialToolCalls.get(event.index);
                    if (toolCall) toolCall.partialJson += event.deltaJson;
                    await ensureStarted();
                    await emit({ type: "message_update", message: updatePartial() });
                    break;
                }

                case "tool_use_end":
                    partialToolCalls.set(event.index, {
                        id: event.id,
                        name: event.name,
                        partialJson: JSON.stringify(event.arguments),
                        arguments: event.arguments,
                    });
                    await ensureStarted();
                    await emit({ type: "message_update", message: updatePartial() });
                    break;

                case "done": {
                    const finalMessage: AssistantMessage = {
                        ...event.message,
                        stopReason: event.message.stopReason ?? event.stopReason,
                    };
                    done = { message: finalMessage, stopReason: finalMessage.stopReason, usage: event.usage };
                    break;
                }

                case "error": {
                    const finalMessage: AssistantMessage = {
                        ...event.message,
                        stopReason: event.message.stopReason ?? event.stopReason,
                    };
                    done = { message: finalMessage, stopReason: finalMessage.stopReason, usage: event.usage };
                    break;
                }
            }
        }
    } catch (error) {
        return fail(error);
    }

    if (!done) {
        return fail(new Error("model stream ended without a done or error event"));
    }

    await ensureStarted(done.message);
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

            if (response.message.stopReason === "error" || response.message.stopReason === "aborted") {
                await emit({ type: "turn_end", turn: turnCount, message: response.message, toolResults: [] });
                return;
            }

            const toolCalls = response.message.toolCalls ?? [];
            hasMoreToolCalls = toolCalls.length > 0;

            const toolResults: Message[] = [];
            for (const tc of toolCalls) {
                if (signal.aborted) break;
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

            // 已中止：不再从队列取 steering / follow-up，排队的消息留给上层处理（clearAllQueues）。
            if (signal.aborted) return;

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
    try {
        await agentLoop(prompts, agentLoopContext, agentLoopConfig, emit, signal);
    } finally {
        await emit({ type: "agent_end", runId, messages: agentLoopContext.messages });
    }
}
