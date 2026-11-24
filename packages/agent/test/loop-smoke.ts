import assert from "node:assert/strict";
import { Type } from "typebox";
import { createMockApi, type CompletionRequest, type Message, type MockStep, type StreamEvent } from "@mini-pi/ai";
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

// ---- 流式生命周期审查第 1、2 条：abort / error 之后不能留下没有结果的 tool call ----

/** 每个 assistant 的 tool call，后面都必须有一条同 id 的 tool result。 */
function assertNoDanglingToolCalls(messages: readonly Message[]): void {
    const answered = new Set(messages.flatMap((m) => (m.role === "tool" ? [m.toolCallId] : [])));
    for (const m of messages) {
        if (m.role !== "assistant") continue;
        for (const call of m.toolCalls ?? []) {
            assert.ok(answered.has(call.id), `tool call ${call.id} 没有对应的 tool result`);
        }
    }
}

/** 用自定义的流构造 Agent；stream 拿到 agent，便于在流的中途 abort。 */
function createStreamAgent(stream: (agent: Agent, request: CompletionRequest) => AsyncIterable<StreamEvent>) {
    const agent: Agent = new Agent({
        streamFn: (request) => stream(agent, request),
        tools: [echoTool],
        initialState: { model: "mock" },
    });
    return agent;
}

const echoCall = { id: "call-1", name: "echo", arguments: { text: "hi" } };

{
    // 第 1 条：输出一段文字后 abort，但 provider 不检查 signal，照样继续发增量和带 toolCalls 的 done
    let calls = 0;
    const requests: CompletionRequest[] = [];
    const agent = createStreamAgent(async function* (a, request) {
        requests.push(request);
        calls += 1;
        if (calls === 1) {
            yield { type: "start", message: { role: "assistant", content: "" } };
            yield { type: "text_delta", delta: "partial" };
            a.abort();
            yield { type: "text_delta", delta: " more" };
            yield {
                type: "done",
                message: { role: "assistant", content: "partial more", toolCalls: [echoCall] },
                stopReason: "tool_use",
            };
            return;
        }
        yield { type: "done", message: { role: "assistant", content: "fresh" }, stopReason: "end_turn" };
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
        events.push(event);
    });
    const before = executions;
    await agent.prompt("hello");
    const last = agent.state.messages.at(-1);
    assert.equal(last?.role, "assistant");
    assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "aborted");
    assert.equal(last?.content, "partial", "中止后的增量不能再拼进消息");
    assert.equal(last?.role === "assistant" ? last.toolCalls : "n/a", undefined);
    assert.equal(events.filter((e) => e.type === "message_update").length, 1, "中止后不能再发 message_update");
    assert.equal(executions, before, "中止后不能执行工具");
    assert.ok(!events.some((e) => e.type === "tool_execution_start"));
    assertNoDanglingToolCalls(agent.state.messages);

    // 用户决定：失败的回答保留已输出的文字发给模型，只去掉 toolCalls
    await agent.prompt("continue");
    const sent = requests[1]?.messages ?? [];
    assert.deepEqual(sent.map((m) => `${m.role}:${m.content}`), ["user:hello", "assistant:partial", "user:continue"]);
    assert.ok(!sent.some((m) => m.role === "assistant" && m.toolCalls));
}

{
    // 第 2 条 a：流到一半的 tool call 之后 provider 抛错，失败消息不能带 toolCalls
    const agent = createStreamAgent(async function* () {
        yield { type: "start", message: { role: "assistant", content: "" } };
        yield { type: "tool_use_start", index: 0, id: "call-1", name: "echo" };
        yield { type: "tool_use_delta", index: 0, deltaJson: '{"text":' };
        throw new Error("boom");
    });
    await agent.prompt("hello");
    const last = agent.state.messages.at(-1);
    assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "error");
    assert.equal(last?.role === "assistant" ? last.errorMessage : undefined, "boom");
    assert.equal(last?.role === "assistant" ? last.toolCalls : "n/a", undefined);
    assertNoDanglingToolCalls(agent.state.messages);
}

{
    // 第 2 条 a（provider 的 error 事件）：带来的消息里有 toolCalls，也要去掉
    const agent = createStreamAgent(async function* () {
        yield {
            type: "error",
            message: { role: "assistant", content: "", toolCalls: [echoCall], errorMessage: "rate limited" },
            stopReason: "error",
        };
    });
    await agent.prompt("hello");
    const last = agent.state.messages.at(-1);
    assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "error");
    assert.equal(last?.role === "assistant" ? last.toolCalls : "n/a", undefined);
    assertNoDanglingToolCalls(agent.state.messages);
}

{
    // 第 2 条 b：一轮两个工具，第一个执行时 abort，第二个不执行但必须有结果
    const twoCalls: MockStep = {
        text: "Calling twice.",
        toolCalls: [
            { name: "echo", arguments: { text: "first" } },
            { name: "echo", arguments: { text: "second" } },
        ],
    };
    const agent = createAgent([twoCalls, { text: "should not be reached" }], (a) => a.abort());
    await agent.prompt("hello");
    const messages = agent.state.messages;
    assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "tool", "tool"]);
    assert.equal(messages[2]?.content, "first");
    const skipped = messages[3];
    assert.equal(skipped?.role === "tool" ? skipped.isError : undefined, true);
    assert.equal(skipped?.content, "ERROR: Operation aborted");
    assertNoDanglingToolCalls(messages);
}

{
    // done 自带失败的 stopReason 且带着 toolCalls：同样去掉 toolCalls，不执行工具
    const before = executions;
    const agent = createStreamAgent(async function* () {
        yield {
            type: "done",
            message: { role: "assistant", content: "oops", toolCalls: [echoCall], stopReason: "error", errorMessage: "bad" },
            stopReason: "error",
        };
    });
    await agent.prompt("hello");
    const last = agent.state.messages.at(-1);
    assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "error");
    assert.equal(last?.role === "assistant" ? last.toolCalls : "n/a", undefined);
    assert.equal(executions, before);
    assertNoDanglingToolCalls(agent.state.messages);
}

{
    // tool 参数流到一半时 abort：不再处理后续事件，结果是没有 toolCalls 的 aborted 消息
    const before = executions;
    const agent = createStreamAgent(async function* (a) {
        yield { type: "start", message: { role: "assistant", content: "" } };
        yield { type: "tool_use_start", index: 0, id: "call-1", name: "echo" };
        a.abort();
        yield { type: "tool_use_delta", index: 0, deltaJson: '{"text":"hi"}' };
        yield { type: "tool_use_end", index: 0, id: "call-1", name: "echo", arguments: { text: "hi" } };
        yield { type: "done", message: { role: "assistant", content: "", toolCalls: [echoCall] }, stopReason: "tool_use" };
    });
    await agent.prompt("hello");
    const last = agent.state.messages.at(-1);
    assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "aborted");
    assert.equal(last?.role === "assistant" ? last.toolCalls : "n/a", undefined);
    assert.equal(executions, before);
    assertNoDanglingToolCalls(agent.state.messages);
}

{
    // provider 先报错、随后才 abort：保留真实的错误信息；没有文字的失败消息下一次整条不发
    let calls = 0;
    const requests: CompletionRequest[] = [];
    const agent = createStreamAgent(async function* (a, request) {
        requests.push(request);
        calls += 1;
        if (calls === 1) {
            yield {
                type: "error",
                message: { role: "assistant", content: "", errorMessage: "rate limited" },
                stopReason: "error",
            };
            a.abort();
            return;
        }
        yield { type: "done", message: { role: "assistant", content: "ok" }, stopReason: "end_turn" };
    });
    await agent.prompt("hello");
    const last = agent.state.messages.at(-1);
    assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "error");
    assert.equal(last?.role === "assistant" ? last.errorMessage : undefined, "rate limited");
    await agent.prompt("again");
    assert.deepEqual(requests[1]?.messages.map((m) => m.role), ["user", "user"]);
}

{
    // 旧 session：修复前批处理中途 abort 存下的是正常的 assistant(tool_use, [a, b]) + tool(a)，b 没有结果。
    // 恢复后发请求时要给 b 补结果，并且紧跟在 tool(a) 后面；历史本身不改。
    const broken: Message[] = [
        { role: "user", content: "hello" },
        {
            role: "assistant",
            content: "Calling twice.",
            stopReason: "tool_use",
            toolCalls: [
                { id: "a", name: "echo", arguments: { text: "first" } },
                { id: "b", name: "echo", arguments: { text: "second" } },
            ],
        },
        { role: "tool", toolCallId: "a", content: "first" },
        // 再来一个同样悬空、后面直接跟 user 的调用
        { role: "assistant", content: "", stopReason: "tool_use", toolCalls: [{ id: "c", name: "echo", arguments: { text: "x" } }] },
    ];
    const requests: CompletionRequest[] = [];
    const agent: Agent = new Agent({
        streamFn: async function* (request) {
            requests.push(request);
            yield { type: "done", message: { role: "assistant", content: "ok" }, stopReason: "end_turn" };
        },
        tools: [echoTool],
        initialState: { model: "mock", messages: broken },
    });
    await agent.prompt("again");
    const sent = requests[0]?.messages ?? [];
    assert.deepEqual(
        sent.map((m) => (m.role === "tool" ? `tool:${m.toolCallId}:${m.content}` : m.role)),
        ["user", "assistant", "tool:a:first", "tool:b:ERROR: No result provided", "assistant", "tool:c:ERROR: No result provided", "user"],
    );
    assertNoDanglingToolCalls(sent);
    // 历史不改：补的结果只出现在请求里
    assert.equal(agent.state.messages.filter((m) => m.role === "tool").length, 1);
}

console.log("agent smoke ok");
