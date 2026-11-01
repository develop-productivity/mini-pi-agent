import type { McpClient } from "./client.ts";
import type { McpToolDef } from "./types.ts";
import type { TSchema } from "typebox";
import { defineTool, type AgentTool } from "@mini-pi/agent";

export function mcpTool(client: McpClient, def: McpToolDef): AgentTool<TSchema> {
    return defineTool({
        name: `mcp__${client.name}__${def.name}`,
        description: def.description ?? `MCP tool from ${client.name}`,
        parameters: def.inputSchema as TSchema,
        execute: async (args, ctx) => {
            return await client.callTool(def.name, args as Record<string, unknown>, ctx.signal);
        }
    });
}
