import type { Api } from "./types.ts";
import { createMockApi } from "./mock.ts";
import { createOpenAiApi } from "./openai.ts";

/** Build the configured model API without choosing a model for the caller. */
export function createApi(): Api {
    const provider = process.env.PROVIDER || "openai";

    switch (provider) {
        case "mock":
            return createMockApi();
        case "openai":
            return createOpenAiApi({
                name: "openai",
                baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
                apiKey: process.env.OPENAI_API_KEY ?? "",
            });
        case "openrouter":
            return createOpenAiApi({
                name: "openrouter",
                baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
                apiKey: process.env.OPENROUTER_API_KEY ?? "",
                headers: {
                    "HTTP-Referer":
                        process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000",
                    "X-Title": process.env.OPENROUTER_APP_TITLE || "mini-pi-agent",
                },
            });
        case "deepseek":
            return createOpenAiApi({
                name: "deepseek",
                baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
                apiKey: process.env.DEEPSEEK_API_KEY ?? "",
            });
        default:
            return createOpenAiApi({
                name: provider,
                baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
                apiKey: process.env.OPENAI_API_KEY ?? "",
            });
    }
}

/** @deprecated Use createApi(). */
export const CreateApi = createApi;
