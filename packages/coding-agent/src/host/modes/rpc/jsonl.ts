/**
 * 严格的 JSONL 读写（参考 pi 的 modes/rpc/jsonl.ts）。
 *
 * 为什么不用 node:readline：readline 除了 \n 还会在 U+2028 / U+2029 等字符处断行，
 * 而这些字符在 JSON 字符串里是合法的（模型输出里可能出现）。用 readline 读就可能把一条
 * JSON 从中间切开。这里只按 \n 切分，行尾的 \r 去掉以兼容 CRLF。
 */
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/** 序列化成一行（JSON.stringify 会把字符串里的换行转义成 \n，所以输出一定是单行）。 */
export function serializeJsonLine(value: unknown): string {
    return `${JSON.stringify(value)}\n`;
}

/**
 * 从流里按 \n 逐行读取。返回取消监听的函数。
 * 用 StringDecoder 而不是直接 chunk.toString()：一个多字节字符（比如中文）可能被拆在两个 chunk 里。
 */
export function attachJsonlLineReader(
    stream: Readable,
    onLine: (line: string) => void,
    onEnd?: () => void,
): () => void {
    const decoder = new StringDecoder("utf8");
    let buffer = "";

    const emit = (line: string) => onLine(line.endsWith("\r") ? line.slice(0, -1) : line);

    const handleData = (chunk: string | Buffer) => {
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
            emit(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
        }
    };

    const handleEnd = () => {
        buffer += decoder.end();
        if (buffer.length > 0) {
            emit(buffer);
            buffer = "";
        }
        onEnd?.();
    };

    stream.on("data", handleData);
    stream.on("end", handleEnd);
    return () => {
        stream.off("data", handleData);
        stream.off("end", handleEnd);
    };
}
