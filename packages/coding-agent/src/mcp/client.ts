// - spawn 子进程
// - 从 stdout 按 \n 读取,解析 JSON
// - 维护 pendingRequests: Map<number, { resolve, reject }>
// - send() 方法:构造 request,发到 stdin,把 promise 存进 pending,返回 promise
// - 收到 response 时,按 id 找 pending 并 resolve
import { spawn, type ChildProcess } from "child_process";
import type {
    JsonRpcIncomingMessage, 
    JsonRpcResponse, 
    JsonRpcNotification,
    JsonRpcRequest,
    McpToolDef,
    ToolsListResult,
    ToolCallResult,
    McpServerConfig } from "./types.ts"

function parseIncoming(text: string): JsonRpcIncomingMessage | null {
    let obj: unknown;
    try { obj = JSON.parse(text); } catch { return null; }
    if (typeof obj !== "object" || obj === null) return null;
    if (!("jsonrpc" in obj) || (obj as any).jsonrpc !== "2.0") return null;
    // 是 response 还是 notification?
    if ("id" in obj) {
        // 简单校验:id 是数字
        if (typeof (obj as any).id !== "number") return null;
        return obj as JsonRpcResponse;
    }
    if ("method" in obj && typeof (obj as any).method === "string") {
        return obj as JsonRpcNotification;
    }
    return null;
}

export class McpClient {
    // 公开字段
    readonly name: string;
    private started = false;
    private child: ChildProcess | null = null;
    private buffer = "";
    private nextId = 1;
    private pending = new Map<number, {
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
    }>();
    private config: McpServerConfig;

    constructor(name: string, config: McpServerConfig) {
        this.name = name;
        this.config = config;
    }
    // 生命周期
    async start(): Promise<void> {
        // 1. spawn 子进程,pipe stdin/stdout,inherit stderr
        this.child = spawn(this.config.command, this.config.args ?? [], { stdio: ["pipe", "pipe", "inherit"] })
        if (!this.child.stdin || !this.child.stdout) {
            throw new Error("stdio pipes not created");
        }
        // 2. 注册 stdout on("exit")
        this.child?.on("exit", (code) => {
            console.warn(`[mcp:${this.name}] server exited with code ${code}`);
            // 未完成的 pending 全部 reject,避免调用方 await 永远挂
            for (const [id, p] of this.pending) {
                p.reject(new Error(`[mcp:${this.name}] server exited unexpectedly`));
            }
            this.pending.clear();
            this.child = null;   // 标记已死
        })
        // 3. 注册 stdout on("data") handler → 调 this.onData
        // 最常见的坑。规则:方法要作为 callback 传给 event emitter / setTimeout / promise then 时,必须捕获 this——用箭头函数或 bind。
        this.child.stdout!.on("data", (chunk) => this.onData(chunk));
        // 4. 发 initialize request,await 结果
        await this.request("initialize", {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            clientInfo: { name: "demo-client", version: "0.1.0" },
        });
        // 5. 发 notifications/initialized notification
        this.notify("notifications/initialized")
        this.started = true
    }

    async close(): Promise<void> {
        if (!this.child) return;
        // reject 里面所有的 pending
        for (const [id, p] of this.pending) {
            p.reject(new Error(`[mcp:${this.name}] client closing`));
        }
        this.pending.clear();
        this.child.kill("SIGTERM");
    }
    killSync(): void {
        if (this.child) {
            this.child.kill("SIGTERM");
            this.child = null;
        }
    }
    // 公开 API
    async listTools(): Promise<McpToolDef[]> {
        const result = await this.request("tools/list") as ToolsListResult;
        return result.tools;
    }

    async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
        const result = await this.request("tools/call", {
            name,
            arguments: args,
            },
            signal
        ) as ToolCallResult;
        // 扁平化 content 数组到字符串
        return result.content
            .map(c => c.type === "text" ? c.text : `[${c.type}]`)
            .join("\n");
    }

    // 私有辅助
    private request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
        // 和你现在的 request 一样,只是用 this.pending / this.nextId / this.send
        if (signal?.aborted) {
            return Promise.reject(new Error("request aborted"));
        }
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const onAbort = () => {
                this.pending.delete(id);          // 只删这一条
                reject(new Error("request aborted"));
            };
            signal?.addEventListener("abort", onAbort, { once: true })
             // 包一层：真正 resolve/reject 之前，先把 abort 监听器摘掉
            const settledResolve = (v: unknown) => {
                signal?.removeEventListener("abort", onAbort);
                resolve(v);
            };
            const settledReject = (e: Error) => {
                signal?.removeEventListener("abort", onAbort);
                reject(e);
            };
            this.pending.set(id, { resolve: settledResolve, reject: settledReject });
            this.send({ jsonrpc: "2.0", id, method, params });
        });
    }

    private notify(method: string, params?: unknown): void {
        this.send({ jsonrpc: "2.0", method, params });
    }

    private send(msg: JsonRpcRequest | JsonRpcNotification): void {
        // 和 send 一样,写 this.child!.stdin
        const line = JSON.stringify(msg) + "\n";
        this.child!.stdin!.write(line);
        // console.log(">>>", JSON.stringify(msg));
    }
    
    private onData(chunk: Buffer): void {
        this.buffer += chunk.toString();
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            if (line.trim() === "") continue;

            const msg = parseIncoming(line);
            if (!msg) {
                console.warn(`[mcp:${this.name}] bad msg:`, line);
                continue;
            }
            
            this.handleMessage(msg);
        }
    }

    private handleMessage(msg: JsonRpcIncomingMessage): void {
        // console.log("<<<", JSON.stringify(msg, null, 2));
        if ("id" in msg) {
            const p = this.pending.get(msg.id);
            if (!p) {
                console.warn(`[mcp:${this.name}] orphan response id=${msg.id}`);
                return;
            }
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
        }
        // notification 暂时不处理
    }
}