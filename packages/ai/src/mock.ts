/**
 * Mock provider — a deterministic, offline LLM.
 *
 * Why this exists: every run of the agent otherwise needs a real API key and
 * real money to verify. That makes the tutorial hard to reproduce and
 * impossible to test in CI. A scripted provider makes the whole loop — turns,
 * tool calls, tool results — runnable with `PROVIDER=mock` and nothing else.
 * （未实现：流式输出、上下文压缩、hooks、权限。做好之后也用这个 mock 测。）
 *
 * The one design constraint worth understanding:
 *
 *   The agent loop may call `CreateApi()` (factory.ts) on every turn, so a
 *   mock holding an instance counter would reset to step 0 every single turn.
 *   Instead the step is *derived from the request*: how many assistant messages
 *   are already in the history. That is stateless, correct across any number of
 *   concurrent sessions, and needs no cleanup.
 *
 * Usage:
 *   PROVIDER=mock MOCK_SCRIPT=./x.json ...    # your own script
 *   MOCK_DELAY_MS=40                          # delay each reply（流式输出未实现）
 *   createMockApi({ script: [...] })          # from a test, no env vars
 */
import { readFileSync } from "node:fs";
import type {
  Api,
  CompletionRequest,
  CompletionResponse,
  Message,
//   StreamEvent,
  ToolCall,
} from "./types.ts";

/** One LLM reply. Index into the script = number of assistant turns so far. */
export interface MockStep {
  /** Reply text（流式输出未实现，现在整段返回）. */
  text?: string;
  /** Tool calls to request. Presence flips stopReason to "tool_use". */
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
  /** Override the stop reason (default: tool_use if toolCalls, else end_turn). */
  stopReason?: CompletionResponse["stopReason"];
}

export interface MockOptions {
  name?: string;
  script?: MockStep[];
  /** Milliseconds before each reply（流式输出实现后也用于每个 chunk 之间）. 0 = no delay. */
  delayMs?: number;
  /** Codepoints per text chunk.（未实现：只有流式输出会用到，现在设了不起作用。） */
  chunkSize?: number;
}

/**
 * Default script: one tool call, then an answer that uses its result. Enough to
 * exercise the full two-level loop (inner tool_call loop + outer turn loop)
 * without any configuration.
 */
export const DEFAULT_SCRIPT: MockStep[] = [
  {
    text: "Let me check the current time for you.\n",
    toolCalls: [{ name: "get_current_time", arguments: {} }],
  },
  {
    text: "Based on the tool result above, that is the current time. "
      + "This reply came from the mock provider — no network, no API key.\n",
  },
];

function loadScriptFromEnv(): MockStep[] | undefined {
  const path = process.env.MOCK_SCRIPT?.trim();
  if (!path) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) {
      process.stderr.write(`[mock] ${path}: expected a JSON array of steps\n`);
      return undefined;
    }
    return parsed as MockStep[];
  } catch (err) {
    // Warn and fall back to the default script, never crash.
    process.stderr.write(`[mock] cannot read ${path}: ${err}\n`);
    return undefined;
  }
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Codepoint-safe chunking so multi-byte characters and emoji never split. */
function chunkText(text: string, size: number): string[] {
  const points = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < points.length; i += size) {
    chunks.push(points.slice(i, i + size).join(""));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") return m.content;
  }
  return "";
}

/**
 * Which step are we on? Derived from history, never from instance state — see
 * the file header for why that matters.
 */
function stepIndex(messages: Message[]): number {
  return messages.filter((m) => m.role === "assistant").length;
}

/**
 * 不传 tools（或传空数组）的请求，一律当成上下文压缩请求：返回一段固定摘要并 end_turn，
 * 不走脚本。所以测试工具调用时一定要传 tools，否则 mock 不会要求调用工具。
 *（上下文压缩本身未实现，见 docs/DESIGN.md。）
 */
function looksLikeCompaction(req: CompletionRequest): boolean {
  return !req.tools || req.tools.length === 0;
}

/** Resolve the reply for this request: a scripted step, or the echo fallback. */
function resolveStep(script: MockStep[], req: CompletionRequest): MockStep {
  const step = script[stepIndex(req.messages)];
  if (step) return step;

  // Script exhausted. Echoing keeps the mock useful indefinitely for UI work.
  const echo = lastUserText(req.messages);
  return {
    text: echo
      ? `[mock echo] ${echo}\n`
      : "[mock] script exhausted and no user message to echo.\n",
  };
}

function toToolCalls(step: MockStep, index: number): ToolCall[] | undefined {
  if (!step.toolCalls?.length) return undefined;
  return step.toolCalls.map((tc, i) => ({
    // Deterministic ids: a test can assert on them.
    id: `mock-call-${index}-${i}`,
    name: tc.name,
    arguments: tc.arguments ?? {},
  }));
}

function stopReasonFor(step: MockStep, toolCalls?: ToolCall[]): CompletionResponse["stopReason"] {
  return step.stopReason ?? (toolCalls?.length ? "tool_use" : "end_turn");
}

/** Rough but stable token estimate for the `usage` field. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(Array.from(text).length / 4));
}

export function createMockApi(options: MockOptions = {}): Api {
  const name = options.name ?? "mock";
  const script = options.script ?? loadScriptFromEnv() ?? DEFAULT_SCRIPT;
  const delayMs = options.delayMs ?? envNumber("MOCK_DELAY_MS", 0);
  // 未实现：chunkSize 只给流式输出用，现在没有读它的代码
  const chunkSize = Math.max(1, options.chunkSize ?? envNumber("MOCK_CHUNK_SIZE", 5));

  function buildResponse(req: CompletionRequest): CompletionResponse {
    if (looksLikeCompaction(req)) {
      const summary =
        "[mock summary] Earlier turns covered the user's request and the tool "
        + "results needed to answer it.";
      return {
        message: { role: "assistant", content: summary },
        stopReason: "end_turn",
        usage: {
          inputTokens: estimateTokens(req.messages.map((m) => m.content ?? "").join("")),
          outputTokens: estimateTokens(summary),
        },
      };
    }

    const index = stepIndex(req.messages);
    const step = resolveStep(script, req);
    const toolCalls = toToolCalls(step, index);
    const text = step.text ?? "";

    return {
      message: { role: "assistant", content: text, ...(toolCalls ? { toolCalls } : {}) },
      stopReason: stopReasonFor(step, toolCalls),
      usage: {
        inputTokens: estimateTokens(req.messages.map((m) => m.content ?? "").join("")),
        outputTokens: estimateTokens(text),
      },
    };
  }

  return {
    name,

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      if (req.signal?.aborted) throw new Error("Request aborted");
      if (delayMs) await sleep(delayMs);
      return buildResponse(req);
    },

    // 未实现：流式输出。types.ts 里的 stream() 接口定好后取消注释。
    // async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    //   const response = buildResponse(req);
    //   const { message } = response;

    //   // Text first, in small chunks: this is what exercises the delta path.
    //   for (const chunk of chunkText(message.content, chunkSize)) {
    //     if (req.signal?.aborted) throw new Error("Request aborted");
    //     if (delayMs) await sleep(delayMs);
    //     yield { type: "text_delta", delta: chunk };
    //   }

    //   // Then tool calls, with their JSON arriving in pieces like a real
    //   // provider's partial-JSON stream.
    //   const toolCalls = message.toolCalls ?? [];
    //   for (const [i, call] of toolCalls.entries()) {
    //     if (req.signal?.aborted) throw new Error("Request aborted");
    //     yield { type: "tool_use_start", index: i, id: call.id, name: call.name };

    //     const json = JSON.stringify(call.arguments);
    //     const mid = Math.ceil(json.length / 2);
    //     for (const piece of [json.slice(0, mid), json.slice(mid)]) {
    //       if (!piece) continue;
    //       if (delayMs) await sleep(delayMs);
    //       yield { type: "tool_use_delta", index: i, deltaJson: piece };
    //     }

    //     yield {
    //       type: "tool_use_end",
    //       index: i,
    //       id: call.id,
    //       name: call.name,
    //       arguments: call.arguments,
    //     };
    //   }

    //   yield {
    //     type: "done",
    //     message,
    //     stopReason: response.stopReason,
    //     ...(response.usage ? { usage: response.usage } : {}),
    //   };
    // },
  };
}
