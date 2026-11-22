/**
 * rpc 模式：无界面运行，让其他程序（编辑器插件、Web 后端、测试脚本）通过 stdin / stdout 驱动 agent
 * （对应 pi 的 modes/rpc/rpc-mode.ts）。协议见 ./types.ts。
 *
 *   PROVIDER=mock npx tsx packages/coding-agent/src/host/cli.ts --mode rpc
 *   然后往 stdin 写：{"id":"1","type":"prompt","message":"现在几点？"}
 *
 * 和 interactive 的区别只在“输入从哪来、输出到哪去”：session 是同一个，renderer 换成了 JSONL 输出。
 *
 * 已实现：读写框架、事件转发、prompt（异步命令的示例）、steer（同步命令的示例）。
 * TODO（用户实现）：follow_up、abort、clear_queue、get_state、set_model，见 handleCommand 里的提示。
 */
import { stdin, stdout } from "node:process";
import type { CodingAgentSession } from "../../../runtime/coding-agent-session.ts";
import type { HostOptions } from "../../types.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type { RpcCommand, RpcCommandType, RpcOutput, RpcResponse } from "./types.ts";

/** stdout 只能写协议数据；所有输出都经过这里。 */
function output(value: RpcOutput): void {
    stdout.write(serializeJsonLine(value));
}

function failure(id: string | undefined, command: RpcCommandType | "parse", error: unknown): RpcResponse {
    const message = error instanceof Error ? error.message : String(error);
    return { id, type: "response", command, success: false, error: message };
}

/**
 * 只做最基本的形状检查：是对象、type 是字符串。
 * TODO（可选）：用 typebox 给 RpcCommand 写 schema 做完整校验（项目里工具参数已经这么做了）。
 */
function parseCommand(line: string): RpcCommand {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || typeof (value as { type?: unknown }).type !== "string") {
        throw new Error("命令必须是带 type 字段的 JSON 对象");
    }
    return value as RpcCommand;
}

export function runRpcMode(session: CodingAgentSession, options: HostOptions): Promise<void> {
    void options; // get_state 会用到 options.sessionPath

    // Agent 事件原样转发成一行 JSON；调用方靠 type !== "response" 识别事件
    session.subscribe((event) => {
        output(event);
    });

    let running: Promise<void> | undefined;

    function handleCommand(command: RpcCommand): void {
        const { id } = command;
        switch (command.type) {
            case "prompt": {
                // 异步命令的示例：先回应“已接受”，再在后台运行；
                // 运行过程和结果通过事件流（message_* / agent_end）告诉调用方。
                if (running) {
                    output(failure(id, "prompt", "已有运行中的 prompt，请用 steer / follow_up"));
                    return;
                }
                output({ id, type: "response", command: "prompt", success: true });
                running = session
                    .prompt(command.message)
                    .catch((error) => {
                        // 已经回应过 success，这里不能再给同一个 id 回第二条响应；写到 stderr
                        process.stderr.write(`[rpc] prompt failed: ${String(error)}\n`);
                    })
                    .finally(() => {
                        running = undefined;
                    });
                return;
            }
            case "steer": {
                // 同步命令的示例：直接调用、立刻回应
                session.steer(command.message);
                output({ id, type: "response", command: "steer", success: true });
                return;
            }
            case "follow_up":
                // TODO：参照 steer，调用 session.followUp()
                output(failure(id, command.type, "TODO: follow_up 还没有实现"));
                return;
            case "abort":
                // TODO：调用 session.abort()。想一想：要不要像 interactive 那样先 clearQueue？
                output(failure(id, command.type, "TODO: abort 还没有实现"));
                return;
            case "clear_queue":
                // TODO：调用 session.clearQueue()，把结果放进 data 返回
                output(failure(id, command.type, "TODO: clear_queue 还没有实现"));
                return;
            case "get_state":
                // TODO：需要 Session 提供只读状态（model、isRunning）。
                //       CodingAgentSession 现在没有这样的方法，要先在 runtime 里加一个 getState()。
                output(failure(id, command.type, "TODO: get_state 还没有实现"));
                return;
            case "set_model":
                // TODO：调用 session.setModel()。想一想：运行中改模型要不要拒绝？
                output(failure(id, command.type, "TODO: set_model 还没有实现"));
                return;
            default: {
                // 编译期穷尽检查：RpcCommand 新增了类型却忘了处理，这里会报类型错误
                const unknownCommand: never = command;
                const type = (unknownCommand as { type: string }).type;
                output(failure(id, "parse", `未知命令：${type}`));
            }
        }
    }

    return new Promise((resolve) => {
        attachJsonlLineReader(
            stdin,
            (line) => {
                if (!line.trim()) return;
                let command: RpcCommand;
                try {
                    command = parseCommand(line);
                } catch (error) {
                    output(failure(undefined, "parse", error));
                    return;
                }
                handleCommand(command);
            },
            async () => {
                // 调用方关闭 stdin：等当前运行结束再返回，dispose 和退出由 cli.ts 负责
                if (running) await running;
                resolve();
            },
        );
    });
}
