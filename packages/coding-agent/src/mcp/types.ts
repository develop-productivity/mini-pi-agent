// JSON-RPC 消息
// JSON-RPC 2.0 规范:一个 response 里 result 和 error 互斥——必须恰好有一个:
export interface JsonRpcRequest { jsonrpc: "2.0"; id: number; method: string; params?: unknown; }
export interface JsonRpcResponse { jsonrpc: "2.0"; id: number; result?: unknown; error?: { code: number; message: string; }; }
export interface JsonRpcNotification { jsonrpc: "2.0"; method: string; params?: unknown; }

export type JsonRpcIncomingMessage = JsonRpcResponse | JsonRpcNotification;

// MCP tool 描述(server 返回的)
export interface McpToolDef {
    name: string;
    description?: string;
    inputSchema: unknown;   // JSON Schema 对象
}

// tools/list 的 result 形状
export interface ToolsListResult {
    tools: McpToolDef[];
}
export interface ToolCallResult {
    content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
    isError?: boolean;
}

// 配置文件类型
export interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
export interface McpConfig {
    servers: Record<string, McpServerConfig>;
}