/**
 * SDK smoke：createSession 只用显式参数组装 Session。
 * 不需要 key、不联网；session 文件写在临时目录。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockApi, type CompletionRequest } from "@mini-pi/ai";
import type { AgentEvent, StreamFn } from "@mini-pi/agent";
import { createSession } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "mini-pi-sdk-"));
const sessionPath = (name: string) => join(dir, "sessions", `${name}.jsonl`);

try {
    {
        // 用 api 配置跑通一轮：调用工具 → 结果回填 → 最终回复
        const { session } = await createSession({
            model: "mock",
            api: { provider: "mock" },
            cwd: dir,
            sessionPath: sessionPath("api"),
        });
        const events: AgentEvent[] = [];
        session.subscribe((event) => {
            events.push(event);
        });
        await session.prompt("现在几点？");
        assert.ok(events.some((e) => e.type === "tool_execution_start" && e.toolName === "get_current_time"));
        assert.equal(events.at(-1)?.type, "agent_end");
        await session.dispose();
    }

    {
        // model 和默认内置工具确实传到了模型请求里；streamFn 优先于 api
        const requests: CompletionRequest[] = [];
        const api = createMockApi();
        const streamFn: StreamFn = (request) => {
            requests.push(request);
            return api.stream(request);
        };
        const { session } = await createSession({
            model: "mock-model-x",
            streamFn,
            // 两个都给时优先用 streamFn；这里的 api 缺 key，若被使用会直接报错
            api: { provider: "deepseek" },
            cwd: dir,
            sessionPath: sessionPath("stream-fn"),
        });
        await session.prompt("hi");
        assert.ok(requests.length > 0);
        assert.equal(requests[0]?.model, "mock-model-x");
        assert.ok(requests[0]?.tools?.some((tool) => tool.name === "read_file"));
        await session.dispose();
    }

    {
        // 显式传空数组 = 不要任何工具（不被默认工具替换）
        const requests: CompletionRequest[] = [];
        const api = createMockApi({ script: [{ text: "ok" }] });
        const { session } = await createSession({
            model: "mock",
            streamFn: (request) => {
                requests.push(request);
                return api.stream(request);
            },
            tools: [],
            cwd: dir,
            sessionPath: sessionPath("no-tools"),
        });
        await session.prompt("hi");
        assert.deepEqual(requests[0]?.tools, []);
        await session.dispose();
    }

    {
        // SDK 不读环境变量：即使设置了 PROVIDER=mock，两个都不给也必须报错
        const saved = process.env.PROVIDER;
        process.env.PROVIDER = "mock";
        try {
            await assert.rejects(
                () => createSession({ model: "mock", cwd: dir, sessionPath: sessionPath("neither") }),
                /必须提供 streamFn 或 api/,
            );
        } finally {
            if (saved === undefined) delete process.env.PROVIDER;
            else process.env.PROVIDER = saved;
        }
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}

console.log("sdk smoke ok");
