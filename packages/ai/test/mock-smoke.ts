import assert from "node:assert/strict";
import { Type } from "typebox";
import {
    apiConfigFromEnv,
    createApi,
    createMockApi,
    type Message,
    type ToolSpec,
} from "../src/index.ts";

const api = createMockApi({
    script: [
        {
            text: "Checking the time.\n",
            toolCalls: [{ name: "get_current_time", arguments: {} }],
        },
        { text: "The tool result arrived.\n" },
    ],
});
const tools: ToolSpec[] = [
    {
        name: "get_current_time",
        description: "Get the current time",
        parameters: Type.Object({}),
    },
];
const messages: Message[] = [{ role: "user", content: "现在几点？" }];

const first = await api.complete({ model: "mock", messages, tools });
assert.equal(first.stopReason, "tool_use");
const call = first.message.toolCalls?.[0];
assert.ok(call);
assert.equal(call.name, "get_current_time");

messages.push(first.message, {
    role: "tool",
    toolCallId: call.id,
    content: "2026-11-01",
});
const second = await api.complete({ model: "mock", messages, tools });
assert.equal(second.stopReason, "end_turn");
assert.match(second.message.content, /tool result arrived/i);

const streamed: string[] = [];
for await (const event of api.stream({ model: "mock", messages: [{ role: "user", content: "hello" }], tools })) {
    streamed.push(event.type);
}
assert.equal(streamed[0], "start");
assert.equal(streamed.at(-1), "done");
assert.ok(streamed.includes("text_delta"));

// ---- provider 配置：只有 apiConfigFromEnv 读环境变量，测试注入假 env，不碰 process.env ----

assert.deepEqual(apiConfigFromEnv({}), { provider: "openai", baseURL: "https://api.openai.com/v1" });
assert.deepEqual(apiConfigFromEnv({ PROVIDER: "mock" }), { provider: "mock" });
assert.deepEqual(apiConfigFromEnv({ PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k" }), {
    provider: "deepseek",
    baseURL: "https://api.deepseek.com",
    apiKey: "k",
});
assert.equal(
    apiConfigFromEnv({ PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k", DEEPSEEK_BASE_URL: "http://proxy" }).baseURL,
    "http://proxy",
);
// 表里没有的 provider：按 OpenAI 兼容处理，读 OPENAI_*
assert.deepEqual(apiConfigFromEnv({ PROVIDER: "groq", OPENAI_API_KEY: "x" }), {
    provider: "groq",
    baseURL: "https://api.openai.com/v1",
    apiKey: "x",
});
const openrouter = apiConfigFromEnv({ PROVIDER: "openrouter", OPENROUTER_API_KEY: "r" });
assert.equal(openrouter.baseURL, "https://openrouter.ai/api/v1");
assert.equal(openrouter.headers, undefined); // 默认头在 provider 表里，不在配置里
assert.deepEqual(
    apiConfigFromEnv({ PROVIDER: "openrouter", OPENROUTER_API_KEY: "r", OPENROUTER_APP_TITLE: "my-app" }).headers,
    { "X-Title": "my-app" },
);

// createApi 不读环境变量：显式配置缺 key 直接报错，报错里带变量名
assert.throws(() => createApi({ provider: "deepseek" }), /DEEPSEEK_API_KEY/);
assert.throws(() => createApi({ provider: "groq" }), /OPENAI_API_KEY/);
assert.equal(createApi({ provider: "deepseek", apiKey: "k" }).name, "deepseek");
assert.equal(createApi({ provider: "mock" }).name, "mock");

// 请求头：用替身 fetch 截获请求，不联网。显式配置 openrouter 也要带上拆分前的默认头
async function capturedHeaders(config: Parameters<typeof createApi>[0]): Promise<Record<string, string>> {
    const realFetch = globalThis.fetch;
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        headers = Object.fromEntries(new Headers(init?.headers).entries());
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    }) as typeof fetch;
    try {
        await createApi(config).complete({ model: "m", messages: [{ role: "user", content: "hi" }] });
    } finally {
        globalThis.fetch = realFetch;
    }
    return headers;
}
const explicitHeaders = await capturedHeaders({ provider: "openrouter", apiKey: "r" });
assert.equal(explicitHeaders["http-referer"], "http://localhost:3000");
assert.equal(explicitHeaders["x-title"], "mini-pi-agent");
const overridden = await capturedHeaders({ provider: "openrouter", apiKey: "r", headers: { "X-Title": "my-app" } });
assert.equal(overridden["x-title"], "my-app");
assert.equal(overridden["http-referer"], "http://localhost:3000");
assert.equal((await capturedHeaders({ provider: "deepseek", apiKey: "k" }))["x-title"], undefined);

console.log("ai smoke ok");
