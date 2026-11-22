import type { Message } from "@mini-pi/ai";
import {
    AgentEventBus,
    type AgentEvent,
    type AgentEventListener,
    type AgentListenerErrorHandler,
} from "./event.ts";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.ts";
import type { AgentTool, StreamFn, AgentLoopConfig, AgentLoopContext, AgentState } from "./types.ts";
import { runAgentLoop, type AgentEventSink} from "./agent-loop.ts";


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

    /** 清空队列，并返回被清掉的消息，便于上层把它们还给用户。 */
    clear(): Message[] {
        return this.messages.splice(0);
    }

    enqueue(message: Message): void {
        this.messages.push(message);
    }

    hasItems(): boolean {
        return this.messages.length > 0;
    }
}

export type AgentLifecycleHandler = (
    event: AgentEvent,
    signal: AbortSignal,
) => Promise<void> | void;

export interface AgentOptions {
    streamFn: StreamFn;  // need implement streamfunction
    tools?: readonly AgentTool[];
    toolRegistry?: ToolRegistry;
    onListenerError?: AgentListenerErrorHandler;
    initialState: AgentInitialState
    onLifecycleEvent?: AgentLifecycleHandler;
}


type MutableAgentState = Omit<AgentState, "streamingMessage" | "pendingToolCalls" | "errorMessage" | "isRunning"> & {
	streamingMessage?: Message;
	pendingToolCalls: Set<string>;
	errorMessage?: string;
};

export type AgentInitialState =  { model: string } & Partial<
	Omit<AgentState, "pendingToolCalls" | "streamingMessage" | "errorMessage" | "isRunning">
>;


function createMutableAgentState(initialState: AgentInitialState): MutableAgentState {
    return {
        messages:  [...(initialState.messages ?? [])],
        model:initialState.model,
        streamingMessage: undefined,
		pendingToolCalls: new Set<string>(),
		errorMessage: undefined,
    }
}

export class Agent {
    private readonly steeringQueue: PendingMessageQueue;
    private readonly followUpQueue: PendingMessageQueue;
    private readonly eventBus: AgentEventBus;
    private readonly toolRegistry: ToolRegistry;
    private readonly streamFn: StreamFn
    private activeRun?: ActiveRun;
    private _state: MutableAgentState;
    private lifecycleSink?: AgentLifecycleHandler

    constructor(
        options:AgentOptions
    ) {
        // const runtimeOptions: Partial<AgentOptions> = {}
        this.streamFn = options.streamFn;
        this.eventBus = new AgentEventBus(options.onListenerError);
        this.toolRegistry = options.toolRegistry ?? createToolRegistry(options.tools ?? []);
        this.steeringQueue = new PendingMessageQueue("one-at-a-time");
        this.followUpQueue = new PendingMessageQueue("all");
        this._state = createMutableAgentState(options.initialState);
        this.lifecycleSink = options.onLifecycleEvent
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

    /** 清空 steering 队列，返回被清掉的消息。 */
    clearSteeringQueue(): Message[] {
        return this.steeringQueue.clear();
    }

    /** 清空 follow-up 队列，返回被清掉的消息。 */
    clearFollowUpQueue(): Message[] {
        return this.followUpQueue.clear();
    }

    /**
     * 清空两个队列，返回被清掉的消息（参考 pi）。
     * abort() 不会自动调用它：排队的消息是用户还没发出的输入，丢掉还是还给输入框由上层决定。
     */
    clearAllQueues(): { steering: Message[]; followUp: Message[] } {
        return {
            steering: this.clearSteeringQueue(),
            followUp: this.clearFollowUpQueue(),
        };
    }

    hasQueuedMessages(): boolean {
        return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
    }

    abort(): void {
        this.activeRun?.abortController.abort()
    }
    setModel(model: string) {
        this._state.model = model
    }
    get state(): AgentState {
        return {
            model:this._state.model,
            messages: this._state.messages,
            streamingMessage: this._state.streamingMessage,
            pendingToolCalls: this._state.pendingToolCalls,
            isRunning: this.activeRun !== undefined,
        };
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
    private createLoopConfig(options: {} = {}): AgentLoopConfig {
        return {
            model:this._state.model,
            toolRegistry: this.toolRegistry,
            streamFn: this.streamFn,
            getSteeringMessages: async () => this.steeringQueue.drain(),
            getFollowUpMessages: async () => this.followUpQueue.drain(),
        }
    }
    private createContextSnapshot(): AgentLoopContext {
        return {
            messages: [...this._state.messages],
            tools: this.toolRegistry.list()
        }
    }

    private async runPromptMessages(messages: Message[], emit: AgentEventSink, signal: AbortSignal): Promise<void> {
        await runAgentLoop(messages, this.createContextSnapshot(), this.createLoopConfig({}), emit, signal)
    }

    async prompt(input: string | Message | Message[]): Promise<void> {
		if (this.activeRun) {
			throw new Error(
				"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
			);
		}
        const run: ActiveRun = { abortController: new AbortController() };
        this.activeRun = run
        const signal = run.abortController.signal;
		try {
            const messages = this.normalizePromptInput(input);
            await this.runPromptMessages(
                messages, 
                (event) => this.processEvents(event, signal),
                signal,
            );
        } finally {
            // 只清理本次运行，避免误清理其他运行的状态
            if (this.activeRun === run) {
                this.activeRun = undefined;
                // 出错或 abort 时 loop 不会发 agent_end，这里兜底清掉运行期状态
                this.clearRunState();
            }
        }
	}

    private clearRunState(): void {
        this._state.streamingMessage = undefined;
        this._state.pendingToolCalls.clear();
    }

    /** 先根据事件更新自己的状态，再转发给监听器：监听器读到的 state 已经是最新的。 */
    private async processEvents(event: AgentEvent, signal: AbortSignal): Promise<void> {
        switch (event.type) {
            
            case "message_start":
            case "message_update":
                this._state.streamingMessage = event.message;
                break;

            case "message_end":
                // 历史只在这里追加：每条进入上下文的消息，loop 都会发一次 message_end
                this._state.streamingMessage = undefined;
                this._state.messages.push(event.message);
                break;

            case "tool_execution_start":
                this._state.pendingToolCalls.add(event.toolCallId);
                break;

            case "tool_execution_end":
                this._state.pendingToolCalls.delete(event.toolCallId);
                break;
            case "agent_end":
                this.clearRunState();
                break;
        }
        await this.lifecycleSink?.(event, signal);
        await this.eventBus.emit(event, signal);
    }
}
