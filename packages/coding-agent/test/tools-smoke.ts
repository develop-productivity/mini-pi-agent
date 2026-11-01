import assert from "node:assert/strict";
import { createBuiltinTools, assertInSandbox } from "../src/index.ts";

const tools = createBuiltinTools({ cwd: process.cwd() });
assert.deepEqual(
    tools.map((tool) => tool.name),
    ["get_current_time", "read_file", "write_file", "edit_file", "bash"],
);

const currentTime = tools.find((tool) => tool.name === "get_current_time");
assert.ok(currentTime);
const result = await currentTime.execute(
    { timezone: "Asia/Shanghai" },
    { signal: new AbortController().signal },
);
assert.ok(result.length > 0);

const root = process.cwd();
assert.equal(assertInSandbox("README.md", root), `${root}/README.md`);
assert.throws(() => assertInSandbox("../outside.txt", root), /escapes sandbox/);

console.log("coding-agent smoke ok");
