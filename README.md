# mini-pi-agent

**一个 agent 的核心原理,压缩进一个 ~200 行的文件里能不能讲清楚?**

这个仓库只做一件事:不依赖任何 agent 框架/SDK,凭对 LLM tool-calling 机制的理解、
加上对真实 API 文档的查阅,手写一个最小但完整可运行的 agent。

> 常说的一句话:"如果不能用 70 行代码写出一个 agent,就不算真的懂 agent 原理。" 这个仓库就是在验证这句话。

---

## 两个文件,一个道理

```
min_executable_demo/agent_med.ts    接真实 DeepSeek API —— 需要 DEEPSEEK_API_KEY
min_executable_demo/agent_mock.ts   同一套 agentLoop/executeTool，callLLM 换成离线 mock —— 不需要任何 key
```

两个文件的 `agentLoop`/`executeTool`/`Tools` 几乎一模一样,**唯一的区别是 `callLLM` 怎么拿到模型的回复**——一个是发 HTTP 请求给 DeepSeek,一个是纯函数、根据"历史里已经有几条 assistant 消息"直接算出该说什么。

**这个对照本身就是这个仓库最想讲清楚的一件事**:agent 的核心循环(读消息 → 决定要不要调用工具 → 执行 → 把结果喂回去 → 重复,直到不再需要工具)跟"到底连的是哪个模型、走不走网络"完全无关——`agentLoop` 不用改一行,换掉 `callLLM` 就能在"真实调用"和"离线跑通"之间切换。

**每个文件都是完全自包含的**——类型定义、工具 schema、格式翻译、核心循环全部写在同一个文件里,不 import 项目里的任何其他本地文件。`provider/types.ts` 目前**没有被使用**,是为以后拆成多文件版本预留的,现在的两个 demo 都刻意不依赖它。

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
