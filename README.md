# mini-pi-agent
agent 系统可以划分为agent_loop, agent_runtime, 以及sandbox.

- agent_loop（智能体执行循环）：即LLM 驱动的感知、推理、规划、执行、观察、评估等循环。决定agent 如何进行决策、迭代和自我纠正。
- agent_runtime（智能体运行时）：为Loop 提供工具调用、记忆管理、多agent协作、可观测性基础设施，目前主流的框架包含：LangChain、AutoGen，CrewAI 等。
- sandbox（执行沙箱）：在代码执行、工具调用、文件操作等不可信行为发生之前提供进程、容器、虚拟机等级别的安全保护、防止宿主环境被逃逸或者滥用。




---

## agent_loop
提供了一个最小可运行的agent_loop: mini-pi-agent/min_executable_demo/min_agent_loop.ts

## agent_runtime


## 快速开始

```bash
npm install
```

**不想配 key,先看看循环本身对不对:**

```bash
npx tsx agent_mock.ts
```

**接真实 DeepSeek:**

```bash
export DEEPSEEK_API_KEY="sk-你的key"
npx tsx min_executable_demo/agent_med.ts
```

或者建一个 `.env`(内容抄 `.env.example`),程序会自动读取,不用每次都 `export`。

```
User: 帮我查一下现在几点
Assistant: Let me check the current time for you.
tool -> get_current_time: {"timezone":"..."}
Assistant: 现在是 ...
```

## 代码里有什么

```
类型定义      Message / Tool / CompletionRequest / CompletionResponse
              —— agent 内部统一用的形状，跟外部 API 长什么样完全无关
              两个文件里各自都有一份（故意不共享，保持每个文件单独能跑）

Tools         3 个工具的 schema：read_file / write_file / get_current_time
              每个都标了 required —— 模型自己会读这份 schema，决定哪些参数必须给

executeTool   真正执行工具，失败时返回错误文本（不是抛异常）

agentLoop     核心循环：
                调用 LLM → 有工具调用就执行、把结果塞回对话 → 没有就停下来

callLLM       min_executable_demo/agent_med.ts 里这个函数还包含一层"格式翻译"：
                内部的 Message[] ←→ DeepSeek/OpenAI 兼容接口认识的 JSON
              agent_mock.ts 里没有这层，因为它压根不碰网络
```

## 实现这类 agent 时要注意的几点

- **网络请求要先检查 `res.ok`,再解析响应体**——不能假设一次 HTTP 调用一定成功;
  失败时对方返回的错误 JSON 跟成功响应的形状完全不同,不做判断会在很远的地方
  炸出一个看不懂根因的空指针错误。
- **避免用 `any` 接外部数据的类型**——一旦某个变量是 `any`,顺着它算出来的所有
  东西都会失去类型检查,包括对象结构错误、字段拼错、漏掉字段这些本该被拦下来
  的问题。
- **跨供应商格式转换时,字段不能漏**——比如把内部的工具调用转成 OpenAI 兼容格式
  时,每一项都需要带上 `id`,后续的工具执行结果要靠这个 `id` 才能跟原始调用对应
  上;漏了不会在转换那一步报错,只会在对方接口那边被拒绝。
- **接住异常之后要真的处理,不能原样再抛一次**——`catch` 里如果只是
  `throw` 出去,等于没加这层保护;应该把错误转成能重新喂回给模型的信息,让
  对话继续,而不是让整个进程崩溃。
- **多轮对话的历史要跨请求持久化**——负责"这一次输入"的函数不该自己从零
  创建消息数组,那样每次新一轮输入都会丢掉之前所有的上下文;累积对话历史的
  那个数组,生命周期要覆盖"整个程序运行期间",而不是"处理一次输入"。
