import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import type { ToolRegistry } from "./registry.ts";
import type { AgentTool, ToolContext } from "./types.ts";

export type ValidateResult =
    | { ok: true; args: Record<string, unknown> }
    | { ok: false; msg: string };

const validatorCache = new WeakMap<TSchema, ReturnType<typeof Compile>>();

export function validateArgs(
    tool: AgentTool<TSchema>,
    rawArgs: Record<string, unknown>,
): ValidateResult {
    const args = structuredClone(rawArgs);
    Value.Convert(tool.parameters, args);

    let validator = validatorCache.get(tool.parameters);
    if (!validator) {
        validator = Compile(tool.parameters);
        validatorCache.set(tool.parameters, validator);
    }

    if (validator.Check(args)) return { ok: true, args };

    const errors = validator
        .Errors(args)
        .map((error: { instancePath?: string; message: string }) =>
            `  - ${error.instancePath || "root"}: ${error.message}`,
        )
        .join("\n");
    return { ok: false, msg: `Validation failed:\n${errors}` };
}

/** Resolve, validate and execute a tool. Failures become model-readable text. */
export async function executeTool(
    registry: ToolRegistry,
    name: string,
    rawArgs: Record<string, unknown>,
    context: ToolContext,
): Promise<string> {
    const tool = registry.get(name);
    if (!tool) return `ERROR: unknown tool: ${name}`;

    try {
        const validation = validateArgs(tool, rawArgs);
        if (!validation.ok) return `ERROR: ${validation.msg}`;
        return await tool.execute(validation.args as never, context);
    } catch (error) {
        return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
}
