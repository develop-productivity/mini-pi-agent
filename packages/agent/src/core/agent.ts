import type { Message } from "@mini-pi/ai";
import {
    AgentEventBus,
    type AgentEventListener,
    type AgentListenerErrorHandler,
} from "./events.ts";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.ts";
import type { AgentTool } from "../tools/types.ts";

type QueueMode = "all" | "one-at-a-time";

class PendingMessageQueue {
    private readonly messages: Message[] = [];

    constructor(private readonly mode: QueueMode) {}

    drain(): Message[] {
        if (this.mode === "all") {
            const drained = this.messages.splice(0);
            return drained;
        }

        const first = this.messages.shift();
        return first ? [first] : [];
    }

    clear(): void {
        this.messages.splice(0);
    }

    enqueue(message: Message): void {
        this.messages.push(message);
    }

    hasItems(): boolean {
        return this.messages.length > 0;
    }
}

export interface AgentOptions {
    tools?: readonly AgentTool[];
    toolRegistry?: ToolRegistry;
    onListenerError?: AgentListenerErrorHandler;
}

export class Agent {
    private readonly steeringQueue = new PendingMessageQueue("one-at-a-time");
    private readonly followUpQueue = new PendingMessageQueue("all");
    private readonly eventBus: AgentEventBus;
    private readonly toolRegistry: ToolRegistry;

    constructor(options: AgentOptions = {}) {
        this.eventBus = new AgentEventBus(options.onListenerError);
        this.toolRegistry = options.toolRegistry ?? createToolRegistry(options.tools ?? []);
    }

    steer(text: string): void {
        this.steeringQueue.enqueue({ role: "user", content: text });
    }

    followUp(text: string): void {
        this.followUpQueue.enqueue({ role: "user", content: text });
    }

    subscribe(listener: AgentEventListener): () => void {
        return this.eventBus.subscribe(listener);
    }

    abort(): void {
        // The active run does not exist until the loop is implemented.
    }

    listTools(): AgentTool[] {
        return this.toolRegistry.list();
    }

    async prompt(_text: string): Promise<void> {
        throw new Error("Agent loop is not implemented yet");
    }
}
