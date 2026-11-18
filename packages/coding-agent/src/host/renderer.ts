/**
 * renderer：把 AgentEvent 翻译成 AgentUI 的调用。
 * 它只认识事件和 AgentUI 接口，不知道输出是终端、TUI 还是测试里的数组，
 * 所以 CLI 和 TUI 可以共用，换的只是 AgentUI 的实现。
 */
import type { AgentEvent, AgentEventListener } from "@mini-pi/agent";
import type { AgentUI } from "./types.ts";

const PREVIEW_LIMIT = 200;

function preview(text: string): string {
    const firstLine = text.split("\n", 1)[0] ?? "";
    const clipped = firstLine.length > PREVIEW_LIMIT ? `${firstLine.slice(0, PREVIEW_LIMIT)}…` : firstLine;
    return text.includes("\n") ? `${clipped} …` : clipped;
}

export function createRenderer(ui: AgentUI): AgentEventListener {
    // 当前这条 assistant 消息是否已经输出过文字，用来决定结束时要不要换行
    let wroteText = false;

    return (event: AgentEvent) => {
        switch (event.type) {
            case "agent_start":
                ui.setStatus("thinking…");
                break;

            case "message_start":
                wroteText = false;
                break;

            case "message_update":
                if (event.message.role === "assistant" && event.delta) {
                    ui.write(event.delta);
                    wroteText = true;
                }
                break;

            case "message_end":
                if (event.message.role !== "assistant") break;
                if (wroteText && !event.message.content.endsWith("\n")) ui.writeLine("");
                if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
                    ui.writeLine(`[${event.message.stopReason}] ${event.message.errorMessage ?? ""}`);
                }
                break;

            case "tool_execution_start": {
                const args = JSON.stringify(event.args);
                if (ui.beginTool) ui.beginTool(event.toolName);
                else ui.writeLine(`→ ${event.toolName} ${args}`);
                break;
            }

            case "tool_execution_update":
                ui.updateTool?.(event.toolName, event.partialResult);
                break;

            case "tool_execution_end": {
                const text = `${event.isError ? "✗" : "✓"} ${preview(event.result)}`;
                if (ui.endTool) ui.endTool(event.toolName, text);
                else ui.writeLine(`  ${text}`);
                break;
            }

            case "agent_end":
                ui.setStatus("");
                break;
        }
    };
}
