/**产品级session 组合 agent 和 资源
 * 和agent 核心的边界是：
 * - Agent = 单次运行状态和循环
 * - Session = 跨运行的产品状态和持久化
 * - Host = 进程、输入输出和生命周期
 * CodingAgentSession
 *  ├── Agent
 *  ├── SessionStorage
 *  ├── 模型 / stream function
 *  ├── 工具集合
 *  ├── sandbox
 *  ├── hooks
 *  ├── session id / cwd
 *  └── session 生命周期
 */

import { Agent, type AgentEvent, type AgentEventListener, type AgentOptions, type AgentLifecycleHandler } from "@mini-pi/agent";
import { SessionStorage } from "../session/storage.ts";
import { buildContext } from "../session/build.ts"
import { createPersistenceHandler } from "./session-event.ts"
export interface CodingAgentSessionOptions {
    sessionStorage?: SessionStorage;
    sessionPath: string;
    cwd: string;
    abortSignal?: AbortSignal;
}

export class CodingAgentSession {
    private readonly agent: Agent;
    private readonly sessionStorage: SessionStorage;
    private activePrompt?: Promise<void>;
    private pendingWrites: Promise<void> = Promise.resolve();
    private disposed = false;
    private readonly listenerUnsubs = new Set<() => void>();

    constructor(agent: Agent, sessionStorage : SessionStorage) {
        this.agent = agent;
		this.sessionStorage = sessionStorage;
    }
    async prompt(text: string): Promise<void> {
        if (this.disposed) {
            throw new Error("This session has been disposed, do not use prompt.")
        }
        this.activePrompt = this.agent.prompt(text);
        try {
            await this.activePrompt
        } finally {
            this.activePrompt = undefined
        }
    }
    steer(text: string): void {
        this.agent.steer(text);
    }
    followUp(text: string) : void {
        this.agent.followUp(text);
    }
    abort() : void {
        this.agent.abort()
    }
    /**
     * 清空排队中的 steering / follow-up，并把文本返回给调用方（参考 pi）。
     * Host 在用户中止时调用它，把这些还没发出的输入放回输入框。
     */
    clearQueue(): { steering: string[]; followUp: string[] } {
        const { steering, followUp } = this.agent.clearAllQueues();
        return {
            steering: steering.map((message) => message.content),
            followUp: followUp.map((message) => message.content),
        };
    }
    /**
     * 订阅事件。目前直接透传 AgentEvent；以后有了 session 自己的事件（AgentSessionEvent），
     * 再决定是合并成一个联合类型还是分开订阅。返回取消订阅的函数。
     */
    subscribe(listener: AgentEventListener): () => void {
        const unsubscribe = this.agent.subscribe(listener);
        this.listenerUnsubs.add(unsubscribe);
        return () => {
            unsubscribe();
            this.listenerUnsubs.delete(unsubscribe);
        };
    }
    // 决定 unSubscribe 是在内部还是在外部
    unsubscribeAll():void {
        for (const unsubscribe of this.listenerUnsubs) {
            unsubscribe()
            this.listenerUnsubs.delete(unsubscribe);
        }
    }
    async setModel(model:string): Promise<void> {
        this.agent.setModel(model);
    }
    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;

        this.agent.abort();
        // 等待结束，不让 prompt 错误阻止资源清理
        await this.activePrompt?.catch((error) => {
            console.error("Prompt failed while disposing session:", error);
        });
        // await this.pendingWrites; // 等待所有 appendFile 完成
        this.unsubscribeAll();
        this.listenerUnsubs.clear();
        // 关闭 MCP client、清理工具资源等
    }
}


export async function createCodingAgentSession(agentOptions: AgentOptions, agentSessionOptions: CodingAgentSessionOptions): Promise<CodingAgentSession>{
    // 创建codingAgentSession
    // 检查 sessionStorage 是否存在,agentConfig.tools 和 agentConfig.toolRegistry 是否冲突；
    // 4. 创建或复用 storage
    const sessionStorage = agentSessionOptions.sessionStorage
        ?? await SessionStorage.openOrCreate(agentSessionOptions.sessionPath, {
            cwd: agentSessionOptions.cwd,
        });
    const historyMessages = buildContext(sessionStorage.getEntries())
    const agent = new Agent({
        tools: agentOptions.tools,
        toolRegistry: agentOptions.toolRegistry,
        streamFn: agentOptions.streamFn,
        onListenerError: agentOptions.onListenerError,
        initialState: {
            ...agentOptions.initialState, // model 由 Host 决定
            messages: historyMessages
        },
        onLifecycleEvent: createPersistenceHandler(sessionStorage)
    })

    return new CodingAgentSession(agent, sessionStorage)
}