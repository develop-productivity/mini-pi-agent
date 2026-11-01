import assert from "node:assert/strict";
import { Type } from "typebox";
import {
    Agent,
    AgentEventBus,
    createToolRegistry,
    defineTool,
    executeTool,
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
const agent = new Agent({ toolRegistry: registry });
assert.deepEqual(agent.listTools().map((tool) => tool.name), ["echo"]);

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

await assert.rejects(() => agent.prompt("not implemented"), /not implemented/);

console.log("agent smoke ok");
