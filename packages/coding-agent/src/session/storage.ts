import type { SessionEntry, SessionHeader, SessionMetadata} from "./types.ts"
import type { Message } from "@mini-pi/ai"
import { readFile, writeFile, appendFile, access } from "node:fs/promises";


// 补齐缺失的类型定义
interface SessionOpts {
  cwd: string;
  id?: string;  // 可选：外部指定 session id，否则内部生成
}

export class SessionStorage {
    private filePath: string;
    private header: SessionHeader;      // 从文件第一行读来
    private entries: SessionEntry[];    // 全量缓存
    private byId: Map<string, SessionEntry>;  // O(1) 查询
    // 私有构造函数，防止外部直接 new
    private constructor(filePath: string, header: SessionHeader, entries: SessionEntry[]) {
        this.filePath = filePath;
        this.entries = entries;
        this.byId = new Map(entries.map(e => [e.id, e]));
        this.header = header
    }

    // 工厂方法：新建 or 打开
    static async create(filePath: string, opts?: SessionOpts): Promise<SessionStorage> {
        const header : SessionHeader = {
            type: "session",
            version: 1,
            id: opts?.id ?? crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            cwd: opts?.cwd ?? process.cwd(),
        };
        await writeFile(filePath, JSON.stringify(header) + "\n", { encoding: "utf-8", flag: "wx"});
        return new SessionStorage(filePath, header, []);
    }
    static async open(filePath: string): Promise<SessionStorage> {
        const content = await readFile(filePath, {encoding: "utf-8"});
        const lines = content.split("\n").filter(line => line.trim() !== "");
        // 空文件（或全是空行）时 lines[0] 是 undefined，JSON.parse(undefined) 会抛
        // 一个毫无信息量的错误。open() 的契约是"打开一个已存在的会话"，空文件是
        // 数据损坏，不能静默当成新会话——那会掩盖问题。
        const headerLine = lines[0];
        if (!headerLine) {
            throw new Error(`session file has no header (empty or corrupt): ${filePath}`);
        }
        const header : SessionHeader = JSON.parse(headerLine);
        const entries = lines.slice(1).map(line => JSON.parse(line) as SessionEntry);
        return new SessionStorage(filePath, header, entries);
    }

    // 元数据
    getMetadata(): SessionMetadata {
        return {
            id: this.header.id,
            createdAt: this.header.createdAt,
            cwd: this.header.cwd,
            path: this.filePath
        };
    }

    // 追加
    async appendEntry(entry: SessionEntry): Promise<void> {
        if (this,this.byId.has(entry.id)) {
            throw new Error(`entry ${entry.id} already exists`);
        }
        await appendFile(this.filePath, JSON.stringify(entry) + "\n")
        this.entries.push(entry)
        this.byId.set(entry.id, entry)
    }
    // 读取
    getEntries(): SessionEntry[] {
        return this.entries;
    }
    getEntry(id: string): SessionEntry | undefined {
        return this.byId.get(id);
    }

    async appendMessage(message: Message): Promise<void> {
        await this.appendEntry({
            type: "message",
            id: crypto.randomUUID(),
            timestamp: Date.now().toString(),
            message
        })
    }
    
}

// const s = await SessionStorage.create("/tmp/test.jsonl");
// await s.appendEntry({ type: "message", id: "1", timestamp: new Date().toISOString(), message: { role: "user", content: "hi" } });
// const s2 = await SessionStorage.open("/tmp/test.jsonl");
// console.log(s2.getEntries());
