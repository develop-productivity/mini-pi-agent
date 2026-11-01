import assert from "node:assert/strict";
import { Type } from "typebox";
import {
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

console.log("ai smoke ok");
