/*

*/
import { Value } from "typebox/value";
import { Compile } from "typebox/compile"
import { type Tool } from "./builtin.ts"
import { type TSchema } from "typebox";

export type ValidateResult = 
    | { ok: true; args: Record<string, unknown> }
    | { ok: false; msg: string }

const validatorCache = new WeakMap();
export function validateArgs(tool: Tool<TSchema>, rawArgs: Record<string, unknown>): ValidateResult {
    const args = structuredClone(rawArgs);
    Value.Convert(tool.parameters, args);
    let v = validatorCache.get(tool.parameters);
    if (!v) { v = Compile(tool.parameters); validatorCache.set(tool.parameters, v); }
    if (v.Check(args)) return { ok: true, args };
    const errs = v.Errors(args).map((e: { instancePath?: string; message: string }) => `  - ${e.instancePath || "root"}: ${e.message}`).join("\n");
    return { ok: false, msg: `Validation failed:\n${errs}` };
}