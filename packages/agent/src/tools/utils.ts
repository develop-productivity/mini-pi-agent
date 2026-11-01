/**
 * utils for tools
 * withLineNumbers
 * assertInSandbox
 * runBash
 */
import { relative, resolve, join } from "node:path";
import { spawn } from "node:child_process";
const SANDBOX_ROOT = resolve(process.cwd());

export function withLineNumbers(text: string): string {
    const lines = text.split("\n");
    const width = String(lines.length).length;
    return lines.map((line, i) => `${String(i + 1).padStart(width, " ")}\t${line}`).join("\n");
}
/**
 * 
 * @param userPath 
 * @returns abs path
 */
export function assertInSandbox(userPath: string): string {
  const abs = resolve(SANDBOX_ROOT, userPath);
  const rel = relative(SANDBOX_ROOT, abs);
  /**相对位置以 ../ 或者 / 都会逃出当前文件夹 */
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error(`path: '${userPath}' escape sandbox '${SANDBOX_ROOT}'`);
  }
  return abs;
}

export interface RunBashOptions {
    timeout?: number;
    maxOutput?: number;
    signal?: AbortSignal;
    /** Fired for each stdout/stderr chunk as it arrives (incremental text). */
    onProgress?: (
        chunk: string,
        stream: "stdout" | "stderr",
    ) => void | Promise<void>;
}

export function killProcessTree(pid: number): void {
    if (process.platform === "win32") {
        try { spawn("taskkill", ["/T", "/F", "/PID", pid.toString()], { stdio: "ignore", detached: true }); }
        catch { /* process may already have exited */ }
        return;
    }
    try { process.kill(-pid, "SIGKILL"); }
    catch { try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ } }
}

export function appendStatus(text: string, status: string): string {
    return text ? `${text}\n\n${status}` : status;
}

export function runBash(
  command: string,
  { timeout, maxOutput = 100_000, signal, onProgress }: RunBashOptions = {},
): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
        if (signal?.aborted) return rejectPromise(new Error("Command aborted"));
        const proc = spawn("bash", ["-c", command], {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let truncated = false;
        let timedOut = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        let progressChain: Promise<void> = Promise.resolve();
        const killOnce = () => { try { if (proc.pid !== undefined) killProcessTree(proc.pid); } catch {} };
        const onAbort = () => killOnce();

        if (timeout !== undefined && timeout > 0) {
        timeoutHandle = setTimeout(() => { timedOut = true; killOnce(); }, timeout * 1000);
        }
        const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        signal?.removeEventListener("abort", onAbort);
        };
        const ingest = (stream: "stdout" | "stderr", data: Buffer): void => {
        const targetLen = (stream === "stdout" ? stdout.length : stderr.length) + data.length;
        if (targetLen > maxOutput) {
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
        proc.on("error", (error) => { cleanup(); rejectPromise(new Error(`spawn error: ${error.message}`)); });
        proc.on("close", (exitCode) => {
        void progressChain.finally(() => {
            cleanup();
            let combined = stdout;
            if (stderr) combined += `${combined ? "\n" : ""}[stderr]\n${stderr}`;
            if (truncated) combined += "\n\n[...truncated]";
            if (signal?.aborted) return rejectPromise(new Error(appendStatus(combined, "Command aborted")));
            if (timedOut) return rejectPromise(new Error(appendStatus(combined, `Command timed out after ${timeout} seconds`)));
            if (exitCode !== 0 && exitCode !== null) {
            return rejectPromise(new Error(appendStatus(combined, `Command exited with code ${exitCode}`)));
            }
            resolvePromise(combined || "(no output)");
        });
        });
    });
}