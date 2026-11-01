/**
 * Cross-package smoke test: ai -> agent -> coding-agent.
 * It is deterministic and does not require an API key or network access.
 */
import assert from "node:assert/strict";
import {
    createMockApi,
    type Message,
    type ToolSpec,
} from "@mini-pi/ai";
import {
    createToolRegistry,
    executeTool,
} from "@mini-pi/agent";
import { createBuiltinTools } from "@mini-pi/coding-agent";

const tools = createBuiltinTools({ cwd: process.cwd() });
const toolSpecs: ToolSpec[] = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
}));
const registry = createToolRegistry(tools);
const api = createMockApi();
const messages: Message[] = [{ role: "user", content: "现在几点？" }];

const first = await api.complete({ model: "mock", messages, tools: toolSpecs });
assert.equal(first.stopReason, "tool_use", "first model turn should request a tool");
const call = first.message.toolCalls?.[0];
assert.ok(call, "first model turn should contain a tool call");

const result = await executeTool(
    registry,
    call.name,
    call.arguments,
    { signal: new AbortController().signal },
);
assert.ok(result.length > 0, "tool result must not be empty");
assert.doesNotMatch(result, /^ERROR:/, "tool execution must succeed");

messages.push(first.message, {
    role: "tool",
    toolCallId: call.id,
    content: result,
});
const second = await api.complete({ model: "mock", messages, tools: toolSpecs });
assert.equal(second.stopReason, "end_turn", "second model turn should finish");
assert.ok(second.message.content.length > 0, "final assistant reply must not be empty");

console.log("cross-package smoke ok");
