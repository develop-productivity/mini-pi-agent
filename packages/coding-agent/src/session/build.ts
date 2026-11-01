import type { Message } from "@mini-pi/ai";
import type { SessionEntry,MessageEntry,CompactionEntry } from "./types.ts";
// 摘要 message 长什么样：把 compaction 的 summary 包装成一条虚拟 user message
// 为什么用 user 角色：让 LLM 把它当"用户提供的背景信息"读入，不需要它自己去理解一段 assistant 说过的话
// 也可以用 system，但多条 system 有的 provider 不喜欢，user 更安全

export function makeSummaryMessage(summary: string): Message{
    return {
        role: "user",
        content: summary
    }
}

export function buildContext(entries: SessionEntry[]): Message[] {
    // 从后往前找最后一条 compaction entry，兼容 ES2022 运行目标。
    //         没找到 → 情况 A：直接过滤所有 message entry 输出
    // findlast 
    let compactionEntry: CompactionEntry | undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!entry) continue;
        if (entry.type === "compaction") {
            compactionEntry = entry;
            break;
        }
    }
    if (!compactionEntry) {
        let messages: Message[];
        messages = entries.filter(e => e.type === "message").map(e => e.message)
        return messages;
    } 
    // [makeSummaryMessage(compaction.summary),
    //       ...从 firstKeptId 到 compaction 之前的 message entries,
    //       ...compaction 之后的 message entries]
    const firstkeepID = compactionEntry.firstKeptEntryId
    const firstKeptIndex = entries.findIndex(e => e.id === firstkeepID);
    const compactionIndex = entries.findIndex(e => e.id === compactionEntry.id);
    // 不使用id，而是使用 
    const keepEntries = entries.slice(firstKeptIndex, compactionIndex).filter((e):e is MessageEntry => e.type === "message").map(e => e.message);
    // 获取 compactionIndex 之后的所有元素（不包含 compactionIndex 本身）
    const afterCompaction = entries.slice(compactionIndex + 1).filter((e):e is MessageEntry => e.type === "message").map(e => e.message);
    
    return [
        makeSummaryMessage(compactionEntry.summary),
        ...keepEntries,
        ...afterCompaction
    ]
}
