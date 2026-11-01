# overview
agent 系统可以划分为agent_loop, agent_runtime, 以及sandbox.

- agent_loop（智能体执行循环）：即LLM 驱动的感知、推理、规划、执行、观察、评估等循环。决定agent 如何进行决策、迭代和自我纠正。
- agent_runtime（智能体运行时）：为Loop 提供工具调用、记忆管理、多agent协作、可观测性基础设施，目前主流的框架包含：LangChain、AutoGen，CrewAI 等。
- sandbox（执行沙箱）：在代码执行、工具调用、文件操作等不可信行为发生之前提供进程、容器、虚拟机等级别的安全保护、防止宿主环境被逃逸或者滥用。

# 

## agent_runtime 

* 工具调用：把除内置工具以外的所有：mcp，skills 都作为插件
* 记忆管理：
    - 存储在本地，append-only JSONL，messages 是派生视图
    - 上下文压缩：超限时摘要，只 append 一条 marker，历史不删
