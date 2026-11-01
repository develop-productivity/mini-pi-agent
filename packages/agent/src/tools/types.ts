import type { Static, TSchema } from "typebox";
import type { ToolSpec } from "@mini-pi/ai";

export type ToolProgressStream = "stdout" | "stderr";

export interface ToolContext {
    signal: AbortSignal;
    /** Incremental output produced while a tool is running. */
    onProgress?: (chunk: string, stream?: ToolProgressStream) => void | Promise<void>;
}

/** A model-facing tool specification plus its executable implementation. */
export interface AgentTool<S extends TSchema = TSchema> extends ToolSpec {
    parameters: S;
    execute(args: Static<S>, ctx: ToolContext): Promise<string>;
}

export function defineTool<S extends TSchema>(tool: AgentTool<S>): AgentTool<S> {
    return tool;
}
