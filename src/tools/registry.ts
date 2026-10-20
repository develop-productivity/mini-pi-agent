import { readFile, writeFile, stat } from "node:fs/promises";
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { Compile } from "typebox/compile"


export const getCurrentTimeSchema = Type.Object({
    timezone: Type.Optional(
        Type.String({ description: "Optional timezone (e.g., 'America/New_York')" }),
    ),
});


export const readFileSchema = Type.Object({
    path: Type.String({ description: "Path to the file to read" }),
});


export const bashSchema = Type.Object({
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export const writeFileSchema = Type.Object({
    path: Type.String({ description: "Path to the file to write" }),
    content: Type.String({ description: "Content to write to the file" }),
});

export const editFileSchema = Type.Object({
    path: Type.String({ description: "Path to the file to edit" }),
    old_string: Type.String({ description: "The exact substring to replace" }),
    new_string: Type.String({ description: "The replacement string" }),
    replace_all: Type.Optional(Type.Boolean({ description: "Whether to replace all occurrences of old_string" })),
});
// 使用 Static 提取出类型
// type GetCurrentTime = Static<typeof getCurrentTimeSchema>;


export type BashArgs = Static<typeof bashSchema>;
export type ReadFileArgs = Static<typeof readFileSchema>;
export type WriteFileArgs = Static<typeof writeFileSchema>;
export type EditFileArgs = Static<typeof editFileSchema>;

export interface ToolContext {
    signal: AbortSignal;
}

//泛型（Generics，即泛化类型）是指在定义函数、接口、类或类型别名时，不预先指定具体的类型，而是在使用的时候再传入具体类型的一种特性。
export interface Tool <S extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters : S;
    // Static<S> 是 TypeBox 提供的类型工具，用来根据一个 Schema 推导出对应的 TypeScript 静态类型。
    // S 表示 Schema 本身的类型，而 Static<S> 表示符合这个 Schema 的参数对象的类型。它们是两种不同的类型。
    execute (args: Static<S>, ctx: ToolContext) : Promise<string>
}

export function defineTool<S extends TSchema>(t: Tool<S>): Tool<S> {
    return t;
}
/*
import { Type, type Static } from "@sinclair/typebox";

// Type.Object() 是 TypeBox 库提供的一个方法，用来定义一个对象的 Schema（数据结构规则）
// 像 TypeScript 的 interface，但两者最关键的区别是：Type.Object() 会创建一个可以在运行时使用的 Schema 对象，
// 而 interface 只用于编译阶段的类型检查。
const SearchSchema = Type.Object({
    query: Type.String(),
    limit: Type.Number()
});
这里的 SearchSchema 不是一个真正的搜索参数对象，而是一个描述参数结构的 Schema 对象。 它大致为：
{
    type: "object",
    properties: {
        query: { type: "string" },
        limit: { type: "number" }
    },
    required: ["query", "limit"]
}

Schema 类型 S = typeof SearchSchema
{
    type: "object",
    properties: {
        query: { type: "string" },
        limit: { type: "number" }
    }
}

参数类型 Static<S>
描述实际传入的数据应该长什么样。
{
    query: string;
    limit: number;
}

*/

// 注册表
export const tools: Tool<TSchema>[] = [
    defineTool({
        name: "get_current_time",
        description: "Get the current time as a string",
        parameters: getCurrentTimeSchema,
        execute: async (args, _ctx) => {
            const { timezone } = args;
            return String(new Date().toLocaleString(timezone || undefined));
        },
    }),
    defineTool({
        name: "read_file",
        description: "Read a file's contents",
        parameters: readFileSchema,
        execute: async (args, _ctx) => {
            const safePath = assertInSandbox(args.path);
            const s = await stat(safePath);
            if (s.isDirectory()) return `ERROR: '${args.path}' is a directory.`;
            const raw = await readFile(safePath, "utf8");
            const MAX = 32 * 1024;
            const truncated = raw.length > MAX;
            const body = truncated ? `${raw.slice(0, MAX)}...` : raw;
            const numbered = withLineNumbers(body);
            return truncated ? `${numbered}\n\n[...truncated, showed first ${MAX} of ${raw.length} bytes]` : numbered;
        },
    }),
    defineTool({
        name: "write_file",
        description: "Write to a file",
        parameters: writeFileSchema,
        execute: async (args, _ctx) => {
            const safePath = assertInSandbox(args.path);
            await writeFile(safePath, args.content);
            return `File ${args.path} written successfully.`;
        }
    }),
    defineTool({
        name: "edit_file",
        description: "Edit a file",
        parameters: editFileSchema,
        execute: async (args, _ctx) => {
            const safePath = assertInSandbox(args.path);
            const s = await stat(safePath);
            if (s.isDirectory()) return `ERROR: '${args.path}' is a directory.`;
            const { old_string, new_string, replace_all } = args;
            if (old_string === new_string) return `ERROR: old_string and new_string are the same.`;
            if (old_string === "") return `ERROR: old_string are empty.`;

            const original_content = await readFile(safePath, "utf8");
            const parts = original_content.split(old_string);
            const count = parts.length - 1;
            if (count === 0) return `ERROR: '${old_string}' not found in file.`;
            if (count > 1 && !replace_all) {
                return `ERROR: '${old_string}' is not unique in ${args.path}. Expand old_string with surrounding context so it uniquely identifies the target, or set replace_all=true.`;
            }
            const updated = replace_all ? parts.join(new_string) : original_content.replace(old_string, new_string);
            console.log(`  → edit ${args.path}: ${count} replacement(s)`);
            console.log(`    - ${old_string.slice(0, 120).replace(/\n/g, "\\n")}`);
            console.log(`    + ${new_string.slice(0, 120).replace(/\n/g, "\\n")}`);
            await writeFile(safePath, updated);
            return `File ${args.path} ${count} replacement.`;
        }
    }),
    defineTool({
        name: "bash",
        description: "Execute a bash command",
        parameters: bashSchema,
        execute: async (args, ctx) => {
            return await runBash(args.command, {
                timeout: args.timeout,
                signal: ctx.signal,
                onProgress: ctx.onProgress,
            });
        }
    }),
];

export const toolsByName: Record<string, Tool<TSchema>> = Object.fromEntries(
    tools.map((tool) => [tool.name, tool]),
);

export function registerTool(tool: Tool) : void {
    tools.push(tool)
    toolsByName[tool.name] = tool
}

export function getTool(name: string): Tool | undefined {
    return toolsByName[name];
}

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