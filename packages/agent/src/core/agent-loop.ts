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

/**
 * 失败（error / aborted）的 assistant 消息：留在历史里，但不能带 toolCalls；
 * 发给模型时只保留已经输出的文字（见 buildRequest）。
 */
function isFailedAssistant(message: Message): message is AssistantMessage {
    return message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted");
}

/** 返回去掉 toolCalls 的新对象；不修改传进来的消息（它可能已经随事件发出去了）。 */
function withoutToolCalls(message: AssistantMessage): AssistantMessage {
    const { toolCalls: _dropped, ...rest } = message;
    return rest;
}

/** 收尾一条 provider 给的最终消息：补上 stopReason；只要结果是失败，就去掉 toolCalls（不分 done / error 事件）。 */
function settleMessage(message: AssistantMessage, stopReason: AssistantMessage["stopReason"]): AssistantMessage {
    const settled: AssistantMessage = { ...message, stopReason: message.stopReason ?? stopReason };
    return isFailedAssistant(settled) ? withoutToolCalls(settled) : settled;
}

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
        // 把消息里的 toolCalls 拿掉：流到一半的调用不会执行，留着就会成为没有结果的 tool call
        const finalMessage: AssistantMessage = {
            ...withoutToolCalls(updatePartial()),
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
            // 已中止就不再处理后续事件：provider 不理会 signal 时，UI 也不会在中止后继续看到增量
            if (request.signal?.aborted) break;
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

                case "done":
                case "error": {
                    // done 也可能自带失败的 stopReason；统一由 settleMessage 判断要不要去掉 toolCalls
                    const finalMessage = settleMessage(event.message, event.stopReason);
                    done = { message: finalMessage, stopReason: finalMessage.stopReason, usage: event.usage };
                    break;
                }
            }
        }
    } catch (error) {
        return fail(error);
    }
    // provider 已经给出失败结果（比如先报错、随后才 abort）时保留真实的错误信息，不改写成 "Request aborted"
    if (request.signal?.aborted && !(done && isFailedAssistant(done.message))) {
        return fail(new Error("Request aborted"));
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

/**
 * 给没有结果的 tool call 补一条错误结果（参考 pi 的 transform-messages）。
 * 只作用于发给模型的请求，不修改历史：修复前存下的旧 session 里可能有这种悬空调用，
 * 恢复后若原样发出，OpenAI 兼容接口会直接拒绝。
 * 补的结果紧跟在该 assistant 已有的 tool result 之后（接口要求同一轮的 tool result 连续出现）。
 */
function closeDanglingToolCalls(messages: Message[]): Message[] {
    const result: Message[] = [];
    let pending: ToolCall[] = [];
    let answered = new Set<string>();

    const close = () => {
        for (const call of pending) {
            if (!answered.has(call.id)) {
                result.push({ role: "tool", toolCallId: call.id, content: "ERROR: No result provided", isError: true });
            }
        }
        pending = [];
        answered = new Set();
    };

    for (const message of messages) {
        if (message.role === "tool") {
            answered.add(message.toolCallId);
            result.push(message);
            continue;
        }
        // 遇到非 tool 消息，说明上一个 assistant 的这一轮结果已经结束
        close();
        result.push(message);
        if (message.role === "assistant" && message.toolCalls?.length) {
            pending = message.toolCalls;
        }
    }
    close();
    return result;
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
    // 失败（error / aborted）的 assistant 消息：保留已经输出的文字发给模型，去掉 toolCalls；
    // 一个字都没有输出的整条不发（空的 assistant 消息有的 provider 会拒绝）。
    // 历史和 JSONL 里仍如实保留原消息。最后再给仍然没有结果的 tool call 补结果，兜住修复前存下的旧 session。
    const visible = closeDanglingToolCalls(
        messages.flatMap((msg): Message[] => {
            if (!isFailedAssistant(msg)) return [msg];
            return msg.content ? [withoutToolCalls(msg)] : [];
        }),
    );
    return {
        model: config.model,
        messages: [...system, ...visible],
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
                if (signal.aborted) {
                    // 不执行，但必须补一条结果：每个 tool call 后面都要有对应的 tool result
                    const skipped: Message = { role: "tool", toolCallId: tc.id, content: "ERROR: Operation aborted", isError: true };
                    await appendMessage(runMessages, skipped, emit);
                    toolResults.push(skipped);
                    continue;
                }
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
