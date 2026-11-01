import { spawn } from "node:child_process";

export interface RunBashOptions {
    cwd?: string;
    timeout?: number;
    maxOutput?: number;
    signal?: AbortSignal;
    onProgress?: (
        chunk: string,
        stream: "stdout" | "stderr",
    ) => void | Promise<void>;
}

export function killProcessTree(pid: number): void {
    if (process.platform === "win32") {
        try {
            spawn("taskkill", ["/T", "/F", "/PID", pid.toString()], {
                stdio: "ignore",
                detached: true,
            });
        } catch {
            // The process may already have exited.
        }
        return;
    }

    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            // The process may already have exited.
        }
    }
}

export function appendStatus(text: string, status: string): string {
    return text ? `${text}\n\n${status}` : status;
}

export function runBash(
    command: string,
    { cwd, timeout, maxOutput = 100_000, signal, onProgress }: RunBashOptions = {},
): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
        if (signal?.aborted) return rejectPromise(new Error("Command aborted"));

        const proc = spawn("bash", ["-c", command], {
            cwd,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let truncated = false;
        let timedOut = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        let progressChain: Promise<void> = Promise.resolve();
        const killOnce = () => {
            try {
                if (proc.pid !== undefined) killProcessTree(proc.pid);
            } catch {
                // The process may already have exited.
            }
        };
        const onAbort = () => killOnce();

        if (timeout !== undefined && timeout > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                killOnce();
            }, timeout * 1000);
        }

        const cleanup = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            signal?.removeEventListener("abort", onAbort);
        };
        const ingest = (stream: "stdout" | "stderr", data: Buffer): void => {
            const nextLength = (stream === "stdout" ? stdout.length : stderr.length) + data.length;
            if (nextLength > maxOutput) {
                if (!truncated) killOnce();
                truncated = true;
                return;
            }

            const chunk = data.toString("utf8");
            if (stream === "stdout") stdout += chunk;
            else stderr += chunk;
            if (!onProgress) return;

            progressChain = progressChain
                .then(() => onProgress(chunk, stream))
                .then(() => undefined)
                .catch(() => undefined);
        };

        proc.stdout.on("data", (data: Buffer) => ingest("stdout", data));
        proc.stderr.on("data", (data: Buffer) => ingest("stderr", data));
        signal?.addEventListener("abort", onAbort, { once: true });
        proc.on("error", (error) => {
            cleanup();
            rejectPromise(new Error(`spawn error: ${error.message}`));
        });
        proc.on("close", (exitCode) => {
            void progressChain.finally(() => {
                cleanup();
                let combined = stdout;
                if (stderr) combined += `${combined ? "\n" : ""}[stderr]\n${stderr}`;
                if (truncated) combined += "\n\n[...truncated]";
                if (signal?.aborted) {
                    return rejectPromise(new Error(appendStatus(combined, "Command aborted")));
                }
                if (timedOut) {
                    return rejectPromise(
                        new Error(appendStatus(combined, `Command timed out after ${timeout} seconds`)),
                    );
                }
                if (exitCode !== 0 && exitCode !== null) {
                    return rejectPromise(
                        new Error(appendStatus(combined, `Command exited with code ${exitCode}`)),
                    );
                }
                resolvePromise(combined || "(no output)");
            });
        });
    });
}
