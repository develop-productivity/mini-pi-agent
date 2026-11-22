/**
 * Session smoke：持久化（message_end 写 JSONL）、恢复（重开时历史进入上下文）、dispose。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockApi, type CompletionRequest } from "@mini-pi/ai";
import type { StreamFn } from "@mini-pi/agent";
import { createSession } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "mini-pi-session-"));
// 父目录还不存在：由 SessionStorage 创建
const sessionPath = join(dir, "nested", "s.jsonl");

// 注意：不要传 tools: []。mock 把“没有工具的请求”当成上下文压缩请求，会返回固定摘要。
function recordingStreamFn(requests: CompletionRequest[]): StreamFn {
    const api = createMockApi({ script: [{ text: "first reply" }, { text: "second reply" }] });
    return (request) => {
        requests.push(request);
        return api.stream(request);
    };
}

try {
    {
        const { session } = await createSession({
            model: "mock",
            streamFn: recordingStreamFn([]),
            cwd: dir,
            sessionPath,
        });
        await session.prompt("remember me");
        await session.dispose();

        // 持久化：header + user + assistant
        const lines = readFileSync(sessionPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        assert.equal(lines[0].type, "session");
        const messages = lines.slice(1).filter((entry) => entry.type === "message").map((entry) => entry.message);
        assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
        assert.equal(messages[0].content, "remember me");

        // dispose 之后不能再 prompt
        await assert.rejects(() => session.prompt("again"), /disposed/);
    }

    {
        // 恢复：同一个文件重开，第一次请求就带上之前的历史
        const requests: CompletionRequest[] = [];
        const { session } = await createSession({
            model: "mock",
            streamFn: recordingStreamFn(requests),
            cwd: dir,
            sessionPath,
        });
        await session.prompt("do you remember?");
        const sent = requests[0]?.messages.map((m) => `${m.role}:${m.content}`) ?? [];
        assert.deepEqual(sent, ["user:remember me", "assistant:first reply", "user:do you remember?"]);
        await session.dispose();
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}

console.log("session smoke ok");
