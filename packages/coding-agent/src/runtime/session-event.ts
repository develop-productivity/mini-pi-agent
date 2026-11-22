// handle(event, signal)
//   ├── queue 状态变化
//   ├── extension event
//   ├── 持久化 message_end
//   ├── 通知 Session public listeners
//   ├── agent_end 时清理本轮状态
//   └── 后续 auto-compaction / retry

import { SessionStorage } from "../session/storage.ts";
import { type AgentLifecycleHandler, type AgentEvent } from "@mini-pi/agent"
import type { SessionEventListener, AgentSessionEvent } from "./types.ts"


export function createPersistenceHandler(
    storage: SessionStorage,
): AgentLifecycleHandler {
    // 持久化失败：
    // → persistenceHandler.appendMessage()
    // → appendFile 失败
    // → 抛出 Error
    return async (event, siginal) => {
        if (event.type === "message_end") {
            try {
                await storage.appendMessage(event.message);
            } catch(error) {
                throw new Error(`Failed to append session message: ${event.message}`, {
                    cause: error,
                });
            }
        }
    };
}

class SessionEventHub {
    private listeners = new Set<SessionEventListener>();

    constructor(
        private readonly storage: SessionStorage,
        // private readonly extensionRunner?: ExtensionRunner,
    ) {}

    subscribe(listener: SessionEventListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    clearRunState(): void {

    }
    async emitPublic(event:AgentEvent): Promise<void> {

    }

    trackQueueOrToolState(event:AgentEvent): void {

    }
    async handle(event: AgentEvent, signal: AbortSignal): Promise<void> {
        // 1. 内部状态
        this.trackQueueOrToolState(event);

        // 2. extension event
        // await this.extensionRunner?.emit(event);

        // 3. 关键持久化
        if (event.type === "message_end") {
            await this.storage.appendMessage(event.message);
        }

        // 4. 通知 Host/public observers
        await this.emitPublic(event);

        // 5. 本轮结束清理
        if (event.type === "agent_end") {
            this.clearRunState();
        }
    }
}