/**
 * agent event
 */
import type { Message, CompletionResponse } from "../providers/types.ts";

export type AgentEvent = 
    | { type: "agent_start"; runId: string }
    | { type: "agent_end"; runId: string; messages: Message[] }
    | { type: "turn_start"; turn: number }
    | { type: "turn_end"; turn: number; message: Message; toolResults: Message[]}


export interface agentEventBus {

}

export type AgentEventListener = (
  event: AgentEvent,
  signal: AbortSignal,
) => void | Promise<void>;