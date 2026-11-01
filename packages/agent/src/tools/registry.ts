import type { AgentTool } from "./types.ts";

/** Per-agent tool lookup. It deliberately has no knowledge of built-in tools. */
export class ToolRegistry {
    private readonly tools = new Map<string, AgentTool>();

    constructor(tools: readonly AgentTool[] = []) {
        for (const tool of tools) this.register(tool);
    }

    register(tool: AgentTool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool already registered: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
    }

    get(name: string): AgentTool | undefined {
        return this.tools.get(name);
    }

    list(): AgentTool[] {
        return Array.from(this.tools.values());
    }
}

export function createToolRegistry(tools: readonly AgentTool[] = []): ToolRegistry {
    return new ToolRegistry(tools);
}
