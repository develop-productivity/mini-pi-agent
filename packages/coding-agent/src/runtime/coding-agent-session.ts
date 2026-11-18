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

import { Agent, type AgentOptions } from "@mini-pi/agent";
import { SessionStorage, type SessionStorageOptions } from "../session/storage.ts";

export interface CodingAgentSessionOptions {
    sessionStorage?: SessionStorage;
    sessionPath: string;
    cwd: string;
    abortSignal?: AbortSignal;
}

class CodingAgentSession {
    private readonly agent: Agent;
    private readonly sessionStorage: SessionStorage;
    constructor(agent: Agent, sessionStorage : SessionStorage) {
        this.agent = agent;
		this.sessionStorage = sessionStorage;
    }
    async prompt(text: string): Promise<void> {
        await this.agent.prompt(text);
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
    subscribe() : void {
        
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

    const agent = new Agent({
        tools: agentOptions.tools,
        toolRegistry: agentOptions.toolRegistry,
        streamFn: agentOptions.streamFn,
        onListenerError: agentOptions.onListenerError,
        initialState: agentOptions.initialState, // model 由 Host 决定
    })
    
    return new CodingAgentSession(agent, sessionStorage)
}