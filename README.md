# mini-pi-agent

**一个 agent 的核心原理,压缩进一个 ~200 行的文件里能不能讲清楚?**

这个仓库只做一件事:不依赖任何 agent 框架/SDK,凭对 LLM tool-calling 机制的理解、
加上对真实 API 文档的查阅,手写一个最小但完整可运行的 agent。

> 常说的一句话:"如果不能用 70 行代码写出一个 agent,就不算真的懂 agent 原理。" 这个仓库就是在验证这句话。

---

## 两个文件,一个道理

```
agent_med.ts    接真实 DeepSeek API —— 需要 DEEPSEEK_API_KEY
agent_mock.ts   同一套 agentLoop/executeTool，callLLM 换成离线 mock —— 不需要任何 key
```

两个文件的 `agentLoop`/`executeTool`/`Tools` 几乎一模一样,**唯一的区别是 `callLLM` 怎么拿到模型的回复**——一个是发 HTTP 请求给 DeepSeek,一个是纯函数、根据"历史里已经有几条 assistant 消息"直接算出该说什么。

**这个对照本身就是这个仓库最想讲清楚的一件事**:agent 的核心循环(读消息 → 决定要不要调用工具 → 执行 → 把结果喂回去 → 重复,直到不再需要工具)跟"到底连的是哪个模型、走不走网络"完全无关——`agentLoop` 不用改一行,换掉 `callLLM` 就能在"真实调用"和"离线跑通"之间切换。

两个文件共用的类型定义(`Message`/`Tool`/`CompletionRequest`/`CompletionResponse`)拆在 [`provider/types.ts`](provider/types.ts) 里——只有一个文件时,内联在文件顶部更简单;现在两个文件都要用同一套类型,拆出来共享才不用维护两份重复的定义。

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
npx tsx agent_med.ts
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
provider/types.ts   Message / Tool / CompletionRequest / CompletionResponse
                    —— agent 内部统一用的形状，跟外部 API 长什么样完全无关
                    两个文件共用同一份，不重复定义

Tools         3 个工具的 schema：read_file / write_file / get_current_time
              每个都标了 required —— 模型自己会读这份 schema，决定哪些参数必须给

executeTool   真正执行工具，失败时返回错误文本（不是抛异常）

agentLoop     核心循环：
                调用 LLM → 有工具调用就执行、把结果塞回对话 → 没有就停下来

callLLM       agent_med.ts 里这个函数还包含一层"格式翻译"：
                内部的 Message[] ←→ DeepSeek/OpenAI 兼容接口认识的 JSON
              agent_mock.ts 里没有这层，因为它压根不碰网络
```

## 调试这份代码时，真实撞上的坑

这些不是"应该注意什么"的清单,是这个 demo 从"写完"到"真的能跑"之间,一步步踩出来的:

| 症状 | 根因 | 教训 |
|---|---|---|
| 函数声明了返回值,`typecheck` 却没报错,运行时却拿到 `undefined` | 忘了 `return`,而函数没标注返回类型,编译器没法替你把关 | **不标注返回类型,少写一个 `return` 都可能悄悄溜过去** |
| `typecheck` 全绿,但真实请求发出去缺字段 | 用了 `any` 接类型,那一整条链上的 bug 全部失去检查 | **`any` 不是"更宽松的检查",是"这里别管我"** |
| `Cannot read properties of undefined (reading '0')` | DeepSeek 返回的是一个错误 JSON(比如缺字段、key 不对),代码却直接假设它是成功响应 | **网络请求必须先检查 `res.ok`,不能假设它一定成功** |
| `messages[2]: missing field 'id'` | 转换成 OpenAI 格式时,工具调用的 `id` 字段被漏掉了 | 翻译两种格式之间的数据,**漏字段不会报错,只会在对方那边被拒绝** |
| `catch` 里又把错误 `throw` 了一次 | 加了 `try/catch`,但只是把异常重新扔出去,等于没加 | **接住错误之后要真的处理,不能接住又扔回去** |
| 对话历史莫名其妙变短 | 每次用户提问都重新 `new` 一个消息数组,上一轮的记忆全丢了 | **持续对话的历史，得活在"整个程序运行期间"那一层，不能活在"处理一次输入"那个函数里** |
