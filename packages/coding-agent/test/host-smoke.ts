/**
 * Host smoke：命令行参数解析，以及 HostOptions 只解析一次 provider、session 路径的优先级。
 * 只测纯函数，不启动 readline、不创建 session。
 */
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { parseHostArgs } from "../src/host/args.ts";
import { ENV_SESSION_DIR, resolveHostOptions } from "../src/host/bootstrap.ts";

// 参数解析
assert.deepEqual(parseHostArgs([]), {});
assert.deepEqual(parseHostArgs(["--session", "a.jsonl", "--session-dir", "d"]), { session: "a.jsonl", sessionDir: "d" });
assert.throws(() => parseHostArgs(["--session"]), /需要一个值/);
assert.throws(() => parseHostArgs(["--session", "--session-dir"]), /需要一个值/);
assert.throws(() => parseHostArgs(["--bogus"]), /未知参数/);

const cwd = resolve("/work/project");
const env = { PROVIDER: "mock" };

// provider 只解析一次：显示和连接用的是同一份 api
const options = resolveHostOptions({}, env, cwd);
assert.deepEqual(options.api, { provider: "mock" });
assert.equal(options.model, "mock");

// session 路径优先级：--session > --session-dir > MINI_PI_SESSION_DIR > <cwd>/.sessions
assert.ok(options.sessionPath.startsWith(join(cwd, ".sessions") + "/"));
assert.ok(options.sessionPath.endsWith(".jsonl"));
const fromEnv = resolveHostOptions({}, { ...env, [ENV_SESSION_DIR]: "/tmp/env-dir" }, cwd);
assert.ok(fromEnv.sessionPath.startsWith("/tmp/env-dir/"));
const fromDirArg = resolveHostOptions({ sessionDir: "arg-dir" }, { ...env, [ENV_SESSION_DIR]: "/tmp/env-dir" }, cwd);
assert.ok(fromDirArg.sessionPath.startsWith(join(cwd, "arg-dir") + "/"));
const fromSessionArg = resolveHostOptions({ session: "s.jsonl", sessionDir: "arg-dir" }, env, cwd);
assert.equal(fromSessionArg.sessionPath, join(cwd, "s.jsonl"));

// 没有默认模型的 provider 必须设置 MODEL
assert.throws(() => resolveHostOptions({}, { PROVIDER: "groq" }, cwd), /MODEL/);

console.log("host smoke ok");
