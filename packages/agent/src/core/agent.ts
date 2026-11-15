import type { Message } from "@mini-pi/ai";
import {
    AgentEventBus,
    type AgentEventListener,
    type AgentListenerErrorHandler,
} from "./event.ts";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.ts";
import type { AgentTool, StreamFn } from "./types.ts";
import { runAgentLoop } from "./agent-loop.ts";


type QueueMode = "all" | "one-at-a-time";
type ActiveRun = {
	abortController: AbortController;
};
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
    streamFn: StreamFn;  // need implement streamfunction
    tools?: readonly AgentTool[];
    toolRegistry?: ToolRegistry;
    onListenerError?: AgentListenerErrorHandler;
}

export class Agent {
    private readonly steeringQueue = new PendingMessageQueue("one-at-a-time");
    private readonly followUpQueue = new PendingMessageQueue("all");
    private readonly eventBus: AgentEventBus;
    private readonly toolRegistry: ToolRegistry;
    private readonly streamFn: StreamFn
    private activeRun?: ActiveRun;

    constructor(
        options:AgentOptions
    ) {
        this.streamFn = options.streamFn;
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
        this.activeRun?.abortController.abort()
        // The active run does not exist until the loop is implemented.
    }

    listTools(): AgentTool[] {
        return this.toolRegistry.list();
    }
    private normalizePromptInput(input: string | Message | Message[]): Message[]{
        if (Array.isArray(input)) {
			return input;
		}
        if (typeof input !== "string") {
			return [input];
		}
        return [{"role": "user", "content": input}]
    }
    async runPromptMessages(messages: Message[]): Promise<void> {
        //
        runAgentLoop(messages, this.toolRegistry, this.streamFn, this.activeRun?.abortController.signal )
        throw new Error("Agent has not implemented")
    }
    async prompt(input: string | Message | Message[]): Promise<void> {
		if (this.activeRun) {
			throw new Error(
				"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
			);
		}
        const run: ActiveRun = { abortController: new AbortController() };
        this.activeRun = run
		try {
            const messages = this.normalizePromptInput(input);
            await this.runPromptMessages(messages, );
        } finally {
            // 只清理本次运行，避免误清理其他运行的状态
            if (this.activeRun === run) {
                this.activeRun = undefined;
            }
        }
	}
}
