/**
 * RPC 协议（参考 pi 的 modes/rpc/rpc-types.ts，只保留 mini-pi 现有能力对应的命令）。
 *
 * 传输：stdin / stdout 上的 JSONL，一行一个 JSON。
 *   - 调用方 → mini-pi（stdin）：RpcCommand
 *   - mini-pi → 调用方（stdout）：RpcResponse（回应某条命令）或 AgentEvent（运行中的事件流）
 *   - 调用方靠 type 区分：type === "response" 是响应，其余都是事件
 *   - 调试日志只能写 stderr，stdout 只能出现协议数据
 *
 * id：调用方可选地给每条命令带 id，响应原样带回，用来把响应和命令对上。
 */
import type { AgentEvent } from "@mini-pi/agent";

export type RpcCommand =
    // 对话
    | { id?: string; type: "prompt"; message: string }
    | { id?: string; type: "steer"; message: string }
    | { id?: string; type: "follow_up"; message: string }
    | { id?: string; type: "abort" }
    | { id?: string; type: "clear_queue" }
    // 状态与模型
    | { id?: string; type: "get_state" }
    | { id?: string; type: "set_model"; model: string };

export type RpcCommandType = RpcCommand["type"];

export interface RpcState {
    model: string;
    sessionPath: string;
    isRunning: boolean;
}

export type RpcResponse =
    | { id?: string; type: "response"; command: "prompt"; success: true }
    | { id?: string; type: "response"; command: "steer" | "follow_up" | "abort" | "set_model"; success: true }
    | { id?: string; type: "response"; command: "clear_queue"; success: true; data: { steering: string[]; followUp: string[] } }
    | { id?: string; type: "response"; command: "get_state"; success: true; data: RpcState }
    // 任何命令都可能失败；无法解析的行 command 为 "parse"
    | { id?: string; type: "response"; command: RpcCommandType | "parse"; success: false; error: string };

/** stdout 上的一行：命令的响应，或者 Agent 的事件。 */
export type RpcOutput = RpcResponse | AgentEvent;
