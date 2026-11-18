/**
 * Host 不需要知道：
 *  - Agent 内部怎么跑 while 循环
 *  - ToolRegistry 怎么查工具
 *  - SessionStorage 怎么追加 JSONL
 *  - 工具如何把错误转成文本
 * Host 只需要：
 *  - 创建 session
 *  - 订阅事件
 *  - 接收输入
 *  - 调用 session.prompt()
 *  - 处理权限交互
 *  - 调用 session.dispose()
 * types.ts：只放类型，不放运行逻辑。
    utils.ts：只放无状态的小工具函数。
    renderer：有明确业务职责，负责把事件翻译成 UI 操作。
    bootstrap：有副作用和生命周期，负责组装依赖并创建 Session。
 */
export interface AgentUI {
    write(text: string): void;
    writeLine(text: string): void;
    setStatus(text: string): void;
    beginTool?(name: string): void;
    updateTool?(name: string, partial: string): void;
    endTool?(name: string, preview: string): void;
}

export interface HostOptions {
    cwd: string;
    sessionPath: string;
    /** 只用于显示；真正选 provider 的是 @mini-pi/ai 的 createApi()（读 PROVIDER）。 */
    provider: string;
    /** 模型由 Host 决定，经 initialState 交给 Agent。 */
    model: string;
    // 其他 Host 配置
}


