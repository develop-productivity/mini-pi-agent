/**
 * CI 冒烟测试：不需要 key、不联网。
 * 验证两个包都能按包名导入，并走一遍：mock 要工具 → 从 agent 包的注册表执行工具 → 喂回结果 → mock 结束。
 */
import assert from "node:assert/strict";
import { Type } from "typebox";
import { createMockApi, type Message, type Tool, type ToolCall } from "@mini-pi/ai";
import { getTool } from "@mini-pi/agent";

const api = createMockApi();
const tools: Tool[] = [
    { name: "get_current_time", description: "Get the current time", parameters: Type.Object({}) },
];
const messages: Message[] = [{ role: "user", content: "现在几点？" }];

const first = await api.complete({ model: "mock", messages, tools });
assert.equal(first.stopReason, "tool_use", "第一步应该请求工具");

// mock 返回的字段是 toolCalls，types.ts 里还是 ToolCalls（PROGRESS 第 1 步统一），两种都兼容
const call = first.message.ToolCalls?.[0] ?? (first.message as { toolCalls?: ToolCall[] }).toolCalls?.[0];
assert.ok(call, "第一步应该带一个工具调用");
const tool = getTool(call.name);
assert.ok(tool, `@mini-pi/agent 的注册表里应该有 ${call.name}`);
const result = await tool.execute(call.arguments, { signal: new AbortController().signal });
assert.ok(result.length > 0, "工具结果不能为空");

messages.push(first.message, { role: "tool", ToolCallId: call.id, content: result });
const second = await api.complete({ model: "mock", messages, tools });
assert.equal(second.stopReason, "end_turn", "喂回工具结果后应该结束");
assert.ok(second.message.content.length > 0, "最终回复不能为空");

console.log("smoke ok");
