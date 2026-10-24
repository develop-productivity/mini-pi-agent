/**
 * 
 */

import type { Message } from "@mini-pi/ai";
import type { agentEventBus, AgentEventListener } from "./events.ts"

type QueueMode = "all" | "one-at-a-time";
class PendingMessageQueue {
    private mode: QueueMode;
    public messages: Message[] = [];

    constructor(mode: QueueMode) {
        this.mode = mode
    }
    drain() : Message[] {
        if (this.mode === "all") {
            const drained = this.messages.slice()
            this.messages = []
            return drained
        }
        // one-at-a-time
        const first = this.messages[0]
        if (!first) return []
        this.messages = this.messages.slice(1)
        return [first]
    }
    clear(): void {
        this.messages = []
    }
    enqueue(msg: Message): void {
        this.messages.push(msg)
    }
    hasItems(): boolean {
        return this.messages.length > 0;
    }
}

export interface AgentUI {
    write(text: string): void;
    writeLine(text: string): void;
    setStatus(text: string): void;
}


export class Agent {
    // ═══════ Pi 对应的两个队列 ═══════
    private steeringQueue = new PendingMessageQueue("one-at-a-time");
    private followUpQueue = new PendingMessageQueue("all");
    private ui: AgentUI;
    private eventBus: agentEventBus; 

    steer(text : string ) : void {

    }
    followUp(text : string) : void {

    }
    subscribe(listener: AgentEventListener) : () => void {
        return this.eventBus[listener]
    }
    abort() : void {

    }
    async prompt(text: string) : Promise<void> {

    }
}