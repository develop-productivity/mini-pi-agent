/**
 * CI 冒烟测试：不需要 key、不联网。
 * 只验证 monorepo 能从 @mini-pi/ai 导入，并且 mock 按脚本先要工具、再给最终回复。
 */
import assert from "node:assert/strict";
import { Type } from "typebox";
import { createMockApi, type Message, type Tool } from "@mini-pi/ai";

const api = createMockApi();
const tools: Tool[] = [
    { name: "get_current_time", description: "Get the current time", parameters: Type.Object({}) },
];
const messages: Message[] = [{ role: "user", content: "现在几点？" }];

const first = await api.complete({ model: "mock", messages, tools });
assert.equal(first.stopReason, "tool_use", "第一步应该请求工具");

messages.push(first.message);
const second = await api.complete({ model: "mock", messages, tools });
assert.equal(second.stopReason, "end_turn", "第二步应该结束");
assert.ok(second.message.content.length > 0, "最终回复不能为空");

console.log("smoke ok");
