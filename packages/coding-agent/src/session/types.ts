
import type { Message } from "@mini-pi/ai";

interface BaseEntry {
    id: string;
    timestamp: string;
}

export interface MessageEntry extends BaseEntry {
    type: "message";
    message: Message
}

export interface CompactionEntry extends BaseEntry {
    type: "compaction";
    summary: string;
    firstKeptEntryId: string // 第一次被保留session id
    tokensBefore: number
}
export interface SessionInfoEntry extends BaseEntry {
    type: "session_info";
    name?: string
}

export type SessionEntry = MessageEntry | CompactionEntry | SessionInfoEntry;

export interface SessionHeader {
    type: "session";
    version: 1
    id: string;
    createdAt: string;
    cwd: string;
}

export interface SessionMetadata {
    id: string;
    createdAt: string;
    cwd: string;
    path: string;
}