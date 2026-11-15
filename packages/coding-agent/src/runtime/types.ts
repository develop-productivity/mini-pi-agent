import type { AgentEvent } from "@mini-pi/agent";
import { type SessionEntry } from "../session/types.ts"



export type AgentSessionEvent = 
    // | AgentEvent // 决定是否重写 AgentEvent
    | { type: "session_start"; sessionId: string }
    | { type: "session_end"; sessionId: string }
    | { type: "entry_appended"; entry: SessionEntry }
    | { type: "session_error"; message: string };