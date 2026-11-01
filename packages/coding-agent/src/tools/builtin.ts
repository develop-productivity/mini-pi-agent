import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Static, Type } from "typebox";
import { defineTool, type AgentTool } from "@mini-pi/agent";
import { runBash } from "../sandbox/bash.ts";
import { assertInSandbox, withLineNumbers } from "../sandbox/path.ts";

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
    timeout: Type.Optional(
        Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
    ),
});

export const writeFileSchema = Type.Object({
    path: Type.String({ description: "Path to the file to write" }),
    content: Type.String({ description: "Content to write to the file" }),
});

export const editFileSchema = Type.Object({
    path: Type.String({ description: "Path to the file to edit" }),
    old_string: Type.String({ description: "The exact substring to replace" }),
    new_string: Type.String({ description: "The replacement string" }),
    replace_all: Type.Optional(
        Type.Boolean({ description: "Whether to replace all occurrences of old_string" }),
    ),
});

export type BashArgs = Static<typeof bashSchema>;
export type ReadFileArgs = Static<typeof readFileSchema>;
export type WriteFileArgs = Static<typeof writeFileSchema>;
export type EditFileArgs = Static<typeof editFileSchema>;

export interface CreateBuiltinToolsOptions {
    /** Workspace root used by file tools and as the bash process cwd. */
    cwd?: string;
    /** Maximum bytes captured from a bash command. */
    maxBashOutput?: number;
}

export function createBuiltinTools(
    options: CreateBuiltinToolsOptions = {},
): AgentTool[] {
    const cwd = resolve(options.cwd ?? process.cwd());

    return [
        defineTool({
            name: "get_current_time",
            description: "Get the current time as a string",
            parameters: getCurrentTimeSchema,
            execute: async (args) => {
                return new Date().toLocaleString(
                    undefined,
                    args.timezone ? { timeZone: args.timezone } : undefined,
                );
            },
        }),
        defineTool({
            name: "read_file",
            description: "Read a file's contents",
            parameters: readFileSchema,
            execute: async (args) => {
                const safePath = assertInSandbox(args.path, cwd);
                const file = await stat(safePath);
                if (file.isDirectory()) return `ERROR: '${args.path}' is a directory.`;

                const raw = await readFile(safePath, "utf8");
                const maxBytes = 32 * 1024;
                const truncated = raw.length > maxBytes;
                const body = truncated ? `${raw.slice(0, maxBytes)}...` : raw;
                const numbered = withLineNumbers(body);
                return truncated
                    ? `${numbered}\n\n[...truncated, showed first ${maxBytes} of ${raw.length} bytes]`
                    : numbered;
            },
        }),
        defineTool({
            name: "write_file",
            description: "Write to a file",
            parameters: writeFileSchema,
            execute: async (args) => {
                const safePath = assertInSandbox(args.path, cwd);
                await writeFile(safePath, args.content);
                return `File ${args.path} written successfully.`;
            },
        }),
        defineTool({
            name: "edit_file",
            description: "Edit a file",
            parameters: editFileSchema,
            execute: async (args, ctx) => {
                const safePath = assertInSandbox(args.path, cwd);
                const file = await stat(safePath);
                if (file.isDirectory()) return `ERROR: '${args.path}' is a directory.`;

                const { old_string, new_string, replace_all } = args;
                if (old_string === new_string) {
                    return "ERROR: old_string and new_string are the same.";
                }
                if (old_string === "") return "ERROR: old_string is empty.";

                const originalContent = await readFile(safePath, "utf8");
                const parts = originalContent.split(old_string);
                const count = parts.length - 1;
                if (count === 0) return `ERROR: '${old_string}' not found in file.`;
                if (count > 1 && !replace_all) {
                    return `ERROR: '${old_string}' is not unique in ${args.path}. Expand old_string with surrounding context so it uniquely identifies the target, or set replace_all=true.`;
                }

                const updated = replace_all
                    ? parts.join(new_string)
                    : originalContent.replace(old_string, new_string);
                await ctx.onProgress?.(
                    `edit ${args.path}: ${count} replacement(s)`,
                    "stdout",
                );
                await writeFile(safePath, updated);
                return `File ${args.path}: ${count} replacement(s).`;
            },
        }),
        defineTool({
            name: "bash",
            description: "Execute a bash command",
            parameters: bashSchema,
            execute: async (args, ctx) => {
                return runBash(args.command, {
                    cwd,
                    timeout: args.timeout,
                    maxOutput: options.maxBashOutput,
                    signal: ctx.signal,
                    onProgress: ctx.onProgress,
                });
            },
        }),
    ];
}
