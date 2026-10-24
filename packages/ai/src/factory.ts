import type { Api } from "./types.ts";
import { createOpenAiApi } from "./openai.ts";
import { createMockApi } from "./mock.ts";

export function CreateApi(): Api {
    let api: Api;
    const provider = process.env.PROVIDER || "openai";
    if (provider === "mock") {
        // Offline, deterministic, no key. See providers/mock.ts.
        api = createMockApi()
    } else if (provider === "openai"){
        api = createOpenAiApi({
            name: "openai",
            baseURL: "https://api.openai.com",
            apiKey: process.env.OPENAI_API_KEY ?? "",
        })
    } else if (provider === "openrouter") {
        // OpenAI-compatible; prefer free models e.g. openrouter/free or *:free
        api = createOpenAiApi({
            name: "openrouter",
            baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY ?? "",
            headers: {
                "HTTP-Referer":
                    process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000",
                "X-Title": process.env.OPENROUTER_APP_TITLE || "mini-pi-agent",
            },
        })
    } else {
        // openai 兼容的格式
        api = createOpenAiApi({
            name: process.env.PROVIDER || "openai",
            baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.openai.com",
            apiKey: process.env.DEEPSEEK_API_KEY ?? "",
        })
    }
    
    return api;
}