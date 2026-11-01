import type { Message } from "@mini-pi/ai";

export type AgentEvent =
    | { type: "agent_start"; runId: string }
    | { type: "agent_end"; runId: string; messages: Message[] }
    | { type: "turn_start"; turn: number }
    | { type: "turn_end"; turn: number; message: Message; toolResults: Message[] }
    | { type: "message_start"; message: Message }
    | { type: "message_update"; message: Message; delta?: string }
    | { type: "message_end"; message: Message }
    | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
    | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: string }
    | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: string; isError: boolean };

export type AgentEventListener = (
    event: AgentEvent,
    signal: AbortSignal,
) => void | Promise<void>;

export type AgentListenerErrorHandler = (error: unknown, event: AgentEvent) => void;

export class AgentEventBus {
    private readonly listeners = new Set<AgentEventListener>();

    constructor(private readonly onListenerError?: AgentListenerErrorHandler) {}

    subscribe(listener: AgentEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Listeners are observers: one failing listener must not stop the run. */
    async emit(event: AgentEvent, signal: AbortSignal): Promise<void> {
        for (const listener of this.listeners) {
            try {
                await listener(event, signal);
            } catch (error) {
                this.onListenerError?.(error, event);
            }
        }
    }
}
