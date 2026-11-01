import assert from "node:assert/strict";
import { Type } from "typebox";
import { createMockApi, type Message, type ToolSpec } from "@mini-pi/ai";

const api = createMockApi({
    script: [
        { toolCalls: [{ name: "get_current_time", arguments: {} }] },
        { text: "done" },
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
messages.push(first.message, { role: "tool", toolCallId: call.id, content: "now" });

const second = await api.complete({ model: "mock", messages, tools });
assert.equal(second.stopReason, "end_turn");
assert.equal(second.message.content, "done");

console.log("ai smoke ok");
