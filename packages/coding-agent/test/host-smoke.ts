/**
 * Host smoke：命令行参数解析，以及 HostOptions 只解析一次 provider、session 路径的优先级。
 * 只测纯函数，不启动 readline、不创建 session。
 */
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { parseHostArgs } from "../src/host/args.ts";
import { attachJsonlLineReader, serializeJsonLine } from "../src/host/modes/rpc/jsonl.ts";
import { ENV_SESSION_DIR, resolveHostOptions } from "../src/host/bootstrap.ts";

// 参数解析
assert.deepEqual(parseHostArgs([]), {});
assert.deepEqual(parseHostArgs(["--session", "a.jsonl", "--session-dir", "d"]), { session: "a.jsonl", sessionDir: "d" });
assert.throws(() => parseHostArgs(["--session"]), /需要一个值/);
assert.throws(() => parseHostArgs(["--session", "--session-dir"]), /需要一个值/);
assert.throws(() => parseHostArgs(["--bogus"]), /未知参数/);
assert.deepEqual(parseHostArgs(["--mode", "print", "hello", "world"]), { mode: "print", messages: ["hello", "world"] });
assert.deepEqual(parseHostArgs(["--mode", "rpc"]), { mode: "rpc" });
assert.throws(() => parseHostArgs(["--mode", "web"]), /--mode 只能是/);
assert.throws(() => parseHostArgs(["--mode"]), /需要一个值/);

// rpc 的 JSONL：只按 \n 切分，字符串里的 U+2028 不能断行；多字节字符跨 chunk 也要拼对；CRLF 去掉 \r
{
    const lines: string[] = [];
    let ended = false;
    const stream = new PassThrough();
    attachJsonlLineReader(stream, (line) => lines.push(line), () => {
        ended = true;
    });
    const withSeparator = serializeJsonLine({ text: "a\u2028b" });
    assert.equal(withSeparator.split("\n").length, 2); // 序列化结果是单行
    stream.write(withSeparator);
    const chinese = Buffer.from('{"text":"中文"}\r\n', "utf8");
    stream.write(chinese.subarray(0, 10)); // 在“中”字的字节中间切开
    stream.write(chinese.subarray(10));
    stream.end('{"last":true}'); // 没有结尾换行的最后一行
    await new Promise((resolve) => stream.on("end", resolve));
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ text: "a\u2028b" }, { text: "中文" }, { last: true }]);
    assert.equal(ended, true);
}

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
