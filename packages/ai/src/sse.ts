export interface SseEvent {
    event: string;      // "message_start" 之类
    data: string;       // 多个 data: 用 \n 拼起来
}
export async function* iterateSse(
    body: ReadableStream<Uint8Array>,
    siginal?: AbortSignal
) : AsyncGenerator<SseEvent>{
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    const dataLines: string[] = [];
    try {
        while (true) {
            // 1. 每次读之前检查 abort
            // 2. reader.read() 拿一块 Uint8Array
            // 3. done 就 break
            // 4. decoder.decode(value, { stream: true }) 拼到 buffer
            // 5. 循环从 buffer 里切出完整行(直到 buffer 里没换行为止)
            //    - 空行 → 如果有攒着的事件,yield 出去,清空
            //    - "event:" 开头 → 记 currentEvent
            //    - "data:" 开头 → push 到 dataLines
            //    - ":" 开头 → 忽略(SSE 注释)
            if (siginal?.aborted) {
                throw new Error("fetch aborted");
            }
            const {done, value} = await reader.read();
            if (done) {
                // 结束前的收尾:把 decoder 憋着的字节冲出来,强制补事件边界
                buffer += decoder.decode();
                buffer += "\n\n";
            } else {
                buffer += decoder.decode(value, { stream: true });
            }
            // 切行逻辑
            while (true) {
                const lineEnd = buffer.indexOf("\n");
                if (lineEnd == -1) break
                const line = buffer.slice(0, lineEnd);
                buffer = buffer.slice(lineEnd + 1);
                const cleanLine = line.endsWith("\r") ? line.slice(0, -1) : line;
                // 遇到空行，事件才结束
                //SSE 允许三种换行符（W3C 规范原话）：\n、\r\n、\r。你 sse.ts 里只切 \n，所以只处理了前两种。
                if (cleanLine === "") {
                    // 兼容 openai 没有 currentEvent
                    if (currentEvent || dataLines.length) {
                        yield {event: currentEvent, data: dataLines.join("\n")};
                        currentEvent = "";
                        dataLines.length = 0;
                    }
                    continue
                }
                if (cleanLine.startsWith(":")) {
                    // SSE 注释,忽略
                } else if (cleanLine.startsWith("event:")) {
                    currentEvent = cleanLine.slice(6).trimStart();
                } else if (cleanLine.startsWith("data:")) {
                    dataLines.push(cleanLine.slice(5).trimStart());
                } else {
                    // 没法识别,丢弃
                }
            }
        }
    } finally {
        reader.releaseLock();       // ← 无论怎么退出,都要放锁
    }
}