import assert from "node:assert/strict";
import { Type } from "typebox";
import { createMockApi, type MockStep } from "@mini-pi/ai";
import {
    Agent,
    AgentEventBus,
    createToolRegistry,
    defineTool,
    executeTool,
    type AgentEvent,
} from "../src/index.ts";

let executions = 0;
const echoTool = defineTool({
    name: "echo",
    description: "Echo a string",
    parameters: Type.Object({ text: Type.String() }),
    execute: async ({ text }) => {
        executions += 1;
        return text;
    },
});

const registry = createToolRegistry([echoTool]);

const result = await executeTool(
    registry,
    "echo",
    { text: "hello" },
    { signal: new AbortController().signal },
);
assert.equal(result, "hello");
assert.equal(executions, 1);

const invalid = await executeTool(
    registry,
    "echo",
    {},
    { signal: new AbortController().signal },
);
assert.match(invalid, /^ERROR: Validation failed:/);
assert.equal(executions, 1);

const unknown = await executeTool(
    registry,
    "missing",
    {},
    { signal: new AbortController().signal },
);
assert.match(unknown, /unknown tool/);

const listenerErrors: unknown[] = [];
const bus = new AgentEventBus((error) => listenerErrors.push(error));
bus.subscribe(() => {
    throw new Error("broken observer");
});
let received = 0;
bus.subscribe(() => {
    received += 1;
});
await bus.emit({ type: "turn_start", turn: 1 }, new AbortController().signal);
assert.equal(received, 1);
assert.equal(listenerErrors.length, 1);

// ---- Agent + mock stream：完整跑一次"请求工具 → 执行 → 回填 → 最终回复" ----

function createAgent(script: MockStep[], onEcho?: (agent: Agent) => void) {
    const api = createMockApi({ script });
    const tool = defineTool({
        name: "echo",
        description: "Echo a string",
        parameters: Type.Object({ text: Type.String() }),
        execute: async ({ text }) => {
            onEcho?.(agent);
            return text;
        },
    });
    const agent: Agent = new Agent({
        streamFn: (req) => api.stream(req),
        tools: [tool],
        initialState: { model: "mock" },
    });
    return agent;
}

/** 把连续的 message_update 合并成一个，便于断言事件顺序。 */
function eventTypes(events: AgentEvent[]): string[] {
    const types: string[] = [];
    for (const event of events) {
        if (event.type === "message_update" && types.at(-1) === "message_update") continue;
        types.push(event.type);
    }
    return types;
}

const callEcho: MockStep = { text: "Calling echo.", toolCalls: [{ name: "echo", arguments: { text: "hi" } }] };

{
    const agent = createAgent([callEcho, { text: "Done." }]);
    assert.deepEqual(agent.listTools().map((tool) => tool.name), ["echo"]);

    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
        events.push(event);
    });
    await agent.prompt("hello");

    assert.deepEqual(eventTypes(events), [
        "agent_start",
        "message_start", "message_end",                        // user prompt
        "turn_start",
        "message_start", "message_update", "message_end",      // assistant + toolCalls
        "tool_execution_start", "tool_execution_end",
        "message_start", "message_end",                        // tool result
        "turn_end",
        "turn_start",
        "message_start", "message_update", "message_end",      // final assistant
        "turn_end",
        "agent_end",
    ]);
    assert.deepEqual(agent.state.messages.map((m) => m.role), ["user", "assistant", "tool", "assistant"]);
    assert.equal(agent.state.messages[2]?.content, "hi");
    assert.equal(agent.state.isRunning, false);
    assert.equal(agent.state.pendingToolCalls.size, 0);

    // 第二次 prompt 带着之前的历史：mock 脚本已用完，会回显最后一条 user 消息。
    await agent.prompt("again");
    assert.deepEqual(agent.state.messages.map((m) => m.role), [
        "user", "assistant", "tool", "assistant", "user", "assistant",
    ]);
    assert.match(agent.state.messages[5]?.content ?? "", /again/);
}

{
    // streamFn 抛错：仍然要补齐 message_start/message_end、turn_end、agent_end。
    const agent = new Agent({
        streamFn: async function* () {
            yield { type: "start", message: { role: "assistant", content: "" } };
            yield { type: "text_delta", delta: "partial" };
            throw new Error("stream failed");
        },
        initialState: { model: "mock" },
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
        events.push(event);
    });
    await agent.prompt("hello");

    const last = agent.state.messages.at(-1);
    assert.equal(last?.role, "assistant");
    assert.equal(last?.stopReason, "error");
    assert.equal(last?.errorMessage, "stream failed");
    assert.deepEqual(eventTypes(events).slice(-2), ["turn_end", "agent_end"]);
}

{
    // stream 没有 done/error：按 error 收尾。
    const agent = new Agent({
        streamFn: async function* () {
            yield { type: "start", message: { role: "assistant", content: "" } };
            yield { type: "text_delta", delta: "partial" };
        },
        initialState: { model: "mock" },
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
        events.push(event);
    });
    await agent.prompt("hello");

    const last = agent.state.messages.at(-1);
    assert.equal(last?.role, "assistant");
    assert.equal(last?.stopReason, "error");
    assert.match(last?.errorMessage ?? "", /without a done or error event/);
    assert.equal(eventTypes(events).at(-1), "agent_end");
}

{
    // 模型流开始后 abort：仍然要有 message_end、turn_end、agent_end。
    const agent = new Agent({
        streamFn: async function* (request) {
            yield { type: "start", message: { role: "assistant", content: "" } };
            if (request.signal?.aborted) throw new Error("aborted");
            yield { type: "text_delta", delta: "should not stream" };
        },
        initialState: { model: "mock" },
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
        events.push(event);
        if (event.type === "message_start" && event.message.role === "assistant") {
            agent.abort();
        }
    });
    await agent.prompt("hello");

    const last = agent.state.messages.at(-1);
    assert.equal(last?.role, "assistant");
    assert.equal(last?.stopReason, "aborted");
    assert.deepEqual(eventTypes(events).slice(-2), ["turn_end", "agent_end"]);
}

{
    // steering：工具执行期间插话，注入在 tool result 之后、下一次模型调用之前。
    let steered = false;
    const agent = createAgent([callEcho, { text: "Saw the steer." }], (a) => {
        if (!steered) a.steer("stop and summarize");
        steered = true;
    });
    await agent.prompt("hello");
    assert.deepEqual(
        agent.state.messages.map((m) => `${m.role}:${m.role === "user" ? m.content : ""}`),
        ["user:hello", "assistant:", "tool:", "user:stop and summarize", "assistant:"],
    );
}

{
    // follow-up：只在模型本来要停下时才注入，之后再跑一轮。
    let queued = false;
    const agent = createAgent([callEcho, { text: "First answer." }, { text: "Follow-up answer." }], (a) => {
        if (!queued) a.followUp("one more thing");
        queued = true;
    });
    await agent.prompt("hello");
    assert.deepEqual(
        agent.state.messages.map((m) => `${m.role}:${m.role === "user" ? m.content : ""}`),
        ["user:hello", "assistant:", "tool:", "assistant:", "user:one more thing", "assistant:"],
    );
    assert.equal(agent.state.messages.at(-1)?.content, "Follow-up answer.");
}

{
    // abort：工具执行中先插话再中止。这一轮收尾后 loop 不再取队列，插话留在队列里等上层处理。
    const agent = createAgent([callEcho, { text: "should not be reached" }], (a) => {
        a.steer("stale");
        a.followUp("later");
        a.abort();
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
        events.push(event);
    });
    await agent.prompt("hello");
    assert.deepEqual(agent.state.messages.map((m) => m.role), ["user", "assistant", "tool"]);
    assert.deepEqual(eventTypes(events).slice(-2), ["turn_end", "agent_end"]);
    assert.equal(agent.hasQueuedMessages(), true);

    const cleared = agent.clearAllQueues();
    assert.deepEqual(cleared.steering.map((m) => m.content), ["stale"]);
    assert.deepEqual(cleared.followUp.map((m) => m.content), ["later"]);
    assert.equal(agent.hasQueuedMessages(), false);
}

{
    // 同一时间只能有一个运行。
    const agent = createAgent([{ text: "ok" }]);
    const running = agent.prompt("first");
    await assert.rejects(() => agent.prompt("second"), /already processing/);
    await running;
}

console.log("agent smoke ok");
