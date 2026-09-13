# agent_med.ts —— 一个最小可运行的 Agent

**能不能不依赖任何 agent 框架/SDK，把 agent 的核心原理压缩进一个约 200 行的文件里，而且还真的能跑起来？**

`agent_med.ts` 就是对这句话的验证：接真实的 DeepSeek API，手写一个最小、但完整可运行的对话式 agent。
它凭的是对 LLM tool-calling 机制的理解，加上对真实 API 文档的查阅——没有 LangChain，没有 SDK，
没有框架魔法。

---

## 它是什么

`agent_med.ts` 是「最小可运行 agent」这一点的完整实现。所谓*完整可运行*，指的是：

- **真的联网**：请求 DeepSeek 的 OpenAI 兼容接口 `https://api.deepseek.com/chat/completions`；
- **真的调用模型**：让模型自己决定要不要用工具、用哪个、传什么参数；
- **真的执行工具**：读文件、写文件、取当前时间；
- **真的多轮对话**：在命令行里一问一答，历史跨轮累积。

而所谓*最小*，指的是整个 agent 的全部组成——类型定义、工具 schema、格式翻译、核心循环、
工具执行、交互入口——全部写在**同一个文件**里，自包含，不 import 项目内任何本地文件。
单独把这一个文件拿走，配一把 API key，就能跑。

一句话概括它的本质：**一个 while 循环，加一层格式翻译。**

---

## 快速开始

```bash
npm install
```

配置 key（二选一），然后运行：

```bash
# 方式一：直接导出环境变量
export DEEPSEEK_API_KEY="sk-你的key"
npx tsx min_executable_demo/agent_med.ts
```

```bash
# 方式二：建一个 .env（内容抄 .env.example）—— 程序会自动读取
DEEPSEEK_API_KEY=sk-your-key-here
```

运行效果大致是这样：

```
User: 帮我查一下现在几点
Assistant: Let me check the current time for you.
tool -> get_current_time: {"timezone":"Asia/Shanghai"}
Assistant: 现在是 2025-... 
User: exit
```

输入为空或 `exit` 即可退出。

---

## 核心：那个循环

整个 agent 的「智能」其实就发生在一个循环里：

```
用户输入
   │
   ▼
把 user 消息推进对话历史
   │
   ▼
┌──────────────── agentLoop ────────────────┐
│  调 callLLM（带上所有工具的定义）          │
│        │                                   │
│        ▼                                   │
│   模型这次要不要调用工具？                  │
│        │ 不要 ──────────► 打印答案，本轮结束 │
│        │ 要                                │
│        ▼                                   │
│   逐个 executeTool 执行                    │
│        │（执行失败也转成文本，不崩）         │
│        ▼                                   │
│   把工具结果作为 tool 消息推回历史          │
│        │                                   │
│        └──────── 带着结果再调一次 ──────────┘
└────────────────────────────────────────────┘
```

- 模型要工具 → 执行 → 把结果喂回去 → 再问模型；
- 模型不要工具 → 说明它给出了最终答复 → 循环结束。

**等到哪天不再需要工具，循环自然停下来**——这就是全部的控制流。没有状态机、没有调度器、
没有中间件链路，就是一个 `while`。

---

## 一个请求的完整生命周期

以「帮我查一下现在几点」为例，看内部数据是怎么流动的：

1. **入口**：`main()` 读到你这句话，push 一条 `user` 消息进 `messages`，调用 `agentLoop(messages)`。
2. **翻译**：`callLLM` 里的 `toOpenAiMessages` / `toOpenAiTools` 把**内部的 `Message[]`** 和工具
   定义，翻译成 **DeepSeek/OpenAI 认识的 JSON**。
3. **请求**：`fetch` 发给 DeepSeek，`Authorization: Bearer $DEEPSEEK_API_KEY`。先取 `text()`、
   判断 `res.ok`，成功才继续。
4. **回译**：`fromOpenAiResponse` 把外部响应翻译回**统一的 `CompletionResponse`**。这一次它带回了
   一个 `toolCalls: [{ name: "get_current_time", arguments: { timezone: "..." } }]`。
5. **执行**：`agentLoop` 逐个调 `executeTool`，真正算出时间，返回字符串结果；结果作为一条
   `role: "tool"` 的消息（带着 `toolCallId`）push 回历史。
6. **再问**：循环回到第 2 步，这次历史里多了那条工具结果。模型读到时间后**不再调用工具**，
   直接给出一句自然语言答复——循环结束，打印答案。

注意第 2 步和第 4 步：**内部形状和外部 JSON 之间隔着一层翻译**。内部循环从头到尾只认自己的
`Message`；OpenAI 兼容格式的长相（`tool_calls`、`arguments` 是字符串、`tool_call_id`……）全部
在翻译层被消化掉。

---

## 代码结构

一个文件，从上到下分成五层：

| 层 | 内容 | 作用 |
| --- | --- | --- |
| 内部类型 | `Tool` / `toolCall` / `Message` / `CompletionRequest` / `CompletionResponse` | agent 统一的数据形状，与外部 API 无关 |
| 外部类型 | `OpenAiToolCall` / `OpenAiResponse` | 专门描述 DeepSeek 返回的原始 JSON |
| 工具表 | `Tools` | 3 个工具的 JSON Schema，会交给模型看 |
| 格式翻译 | `toOpenAiMessages` / `toOpenAiTools` / `mapToolCall` / `fromOpenAiResponse` | 内部形状 ←→ OpenAI 兼容 JSON 的双向转换 |
| 核心逻辑 | `callLLM` / `executeTool` / `agentLoop` / `main` | 调用模型、执行工具、循环、交互入口 |

**工具表的三个工具：**

```
read_file        参数 { file_path: string }
write_file       参数 { file_path: string, content: string }
get_current_time 参数 { timezone: string }
```

每个都标了 `required`。模型就是读这份 schema，来决定"调哪个工具、必须给哪些参数"——它的
"能力边界"完全由这张表定义。

---

## 设计要点

几点让这份实现"能跑通"而不只是"能编译"的关键决定：

- **内外类型分离**：内部 `Message` 与外部 `OpenAiResponse` 各管一段，所有格式差异集中在几个
  小翻译函数里。想换供应商，只动翻译层。
- **先判 `res.ok`，再解析 body**：失败响应和成功响应的 JSON 形状完全不同，顺序反了会在很远的
  地方炸出一个看不懂根因的错误。
- **工具失败不炸进程**：`executeTool` 抛出的异常被 `agentLoop` 的 `try/catch` 接住，转成
  `ERROR: ...` 文本**喂回给模型**，让对话能自我纠错、继续下去。
- **工具结果统一为字符串**：成功与否都返回文本，方便直接塞进 `tool` 消息。
- **历史跨轮持久化**：`messages` 数组的生命周期覆盖整个进程，而不是"处理一次输入"——否则
  每轮都会丢掉之前的上下文。
- **`arguments` 的成对序列化**：对外 `JSON.stringify`，对内 `JSON.parse`，双向转换里必须成对
  出现，漏一边就在对方接口那里被拒。
- **刻意的简化**：`usage`、`stopReason`、`finish_reason` 等字段被省略——它们不影响循环的正确性，
  省掉是为了让主体更清晰。

---

## 技术栈

- **运行**：Node.js + `tsx`（直接跑 TypeScript）
- **类型**：TypeScript，工具的 `parameter` 用 `typebox` 的 `TSchema` 描述
- **依赖**：仅 `typebox`；其余全是 Node 内置（`readline`、`node:fs/promises`、`fetch`）
- **模型**：DeepSeek（OpenAI 兼容接口），当前调用 `deepseek-flash`
- **环境变量**：`DEEPSEEK_API_KEY`

```bash
npm run typecheck   # tsc --noEmit，纯类型检查
```
