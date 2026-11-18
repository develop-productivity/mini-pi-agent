/**
 * 最小 CLI Host：readline 读输入，事件经 renderer 打到终端。
 *
 *   PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts
 *
 * - 空闲时输入一行 → session.prompt()
 * - 运行中输入一行 → session.steer()，本轮工具执行完后插入
 * - 运行中 Ctrl+C → 先取回排队的输入、再中止；空闲时 Ctrl+C 或 /exit → 退出
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { createHostSession, resolveHostOptions } from "./bootstrap.ts";
import { createRenderer } from "./renderer.ts";
import type { AgentUI } from "./types.ts";

try {
    process.loadEnvFile();
} catch {
    // 没有 .env 就用当前环境变量
}

const consoleUI: AgentUI = {
    write: (text) => {
        stdout.write(text);
    },
    writeLine: (text) => {
        stdout.write(`${text}\n`);
    },
    // CLI 不画状态栏，留给 TUI
    setStatus: () => {},
};

const options = resolveHostOptions();
const session = await createHostSession(options);
session.subscribe(createRenderer(consoleUI));

consoleUI.writeLine(`mini-pi · provider=${options.provider} · model=${options.model}`);
consoleUI.writeLine("输入后回车发送；运行中再输入会插话（steer）；Ctrl+C 中止，/exit 退出。");

const rl = createInterface({ input: stdin, output: stdout, prompt: "> " });
let running: Promise<void> | undefined;
let closed = false;
let restoreText = "";

function showPrompt(): void {
    if (closed) return;
    rl.prompt();
    // 中止时取回的排队输入，放回输入行让用户决定改了再发还是删掉
    if (restoreText) {
        rl.write(restoreText);
        restoreText = "";
    }
}

async function run(text: string): Promise<void> {
    try {
        await session.prompt(text);
    } catch (error) {
        consoleUI.writeLine(`[error] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        running = undefined;
        showPrompt();
    }
}

rl.on("line", (line) => {
    const text = line.trim();
    if (text === "/exit") {
        rl.close();
        return;
    }
    if (!text) {
        if (!running) showPrompt();
        return;
    }
    if (running) {
        session.steer(text);
        consoleUI.writeLine("(已排队：本轮工具执行完后插入)");
        return;
    }
    running = run(text);
});

rl.on("SIGINT", () => {
    if (!running) {
        rl.close();
        return;
    }
    // 先取回队列再中止，避免中止生效前 loop 又把它们取走
    const { steering, followUp } = session.clearQueue();
    restoreText = [...steering, ...followUp].join(" ");
    session.abort();
    consoleUI.writeLine("\n(已中止)");
});

rl.on("close", async () => {
    closed = true;
    // stdin 被关掉（比如管道输入读完）时，等当前这次运行结束再退出
    if (running) await running;
    process.exit(0);
});

showPrompt();
