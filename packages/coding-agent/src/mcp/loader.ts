import { readFile } from "node:fs/promises";
import type { McpConfig, McpServerConfig } from "./types.ts";

function isValidServerConfig(v: unknown): v is McpServerConfig {
    if (typeof v !== "object" || v === null) return false;
    const c = v as Record<string, unknown>;
    if (typeof c.command !== "string") return false;
    if (c.args !== undefined && !Array.isArray(c.args)) return false;
    if (c.args && !(c.args as unknown[]).every(a => typeof a === "string")) return false;
    return true;
}

export async function loadMcpConfig(path: string): Promise<McpConfig> {
    try {
        const text = await readFile(path, "utf8");
        const data = JSON.parse(text);
        if (typeof data !== "object" || data === null || typeof data.servers !== "object") {
            console.warn(`[mcp] ${path}: expected { servers: {...} }`);
            return { servers: {} };
        }
        const servers: Record<string, McpServerConfig> = {};
        for (const [name, cfg] of Object.entries(data.servers as Record<string, unknown>)) {
            if (isValidServerConfig(cfg)) {
                servers[name] = cfg;
            } else {
                console.warn(`[mcp] ${path}: invalid config for server "${name}", skipped`);
            }
        }
        return { servers };
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
            console.log(`[mcp] ${path} not found, no MCP servers configured`);
        } else {
            console.warn(`[mcp] cannot load ${path}:`, err);
        }
        return { servers: {} };
    }
}