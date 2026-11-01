import { isAbsolute, relative, resolve, sep } from "node:path";

export function withLineNumbers(text: string): string {
    const lines = text.split("\n");
    const width = String(lines.length).length;
    return lines
        .map((line, index) => `${String(index + 1).padStart(width, " ")}\t${line}`)
        .join("\n");
}

/** Resolve a user path and reject paths outside the configured workspace root. */
export function assertInSandbox(userPath: string, root: string): string {
    const sandboxRoot = resolve(root);
    const absolutePath = resolve(sandboxRoot, userPath);
    const relativePath = relative(sandboxRoot, absolutePath);

    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new Error(`path: '${userPath}' escapes sandbox '${sandboxRoot}'`);
    }

    return absolutePath;
}
