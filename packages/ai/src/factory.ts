import type { Api, ApiConfig } from "./types.ts";
import { createMockApi } from "./mock.ts";
import { createOpenAiApi } from "./openai.ts";


const DEFAULT_PROVIDER = "openai";   // 和 bootstrap 的 resolveHostOptions 保持一致
// 表里没有的 provider 当作 OpenAI 兼容，读 OPENAI_* 变量（沿用原来 default 分支的行为）
const OPENAI_COMPATIBLE: ProviderDefaults = {
    baseURL: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", baseURLEnv: "OPENAI_BASE_URL",
};

interface ProviderDefaults {
    baseURL: string;
    apiKeyEnv: string;          // 对应 pi 的 envMap
    baseURLEnv?: string;        // 允许用环境变量覆盖默认地址，比如 DEEPSEEK_BASE_URL
    /** 默认请求头。显式配置也会带上；ApiConfig.headers 里的同名头会覆盖它。 */
    headers?: Record<string, string>;
}
const PROVIDERS: Record<string, ProviderDefaults> = {
    openai:     { baseURL: "https://api.openai.com/v1",    apiKeyEnv: "OPENAI_API_KEY",     baseURLEnv: "OPENAI_BASE_URL" },
    openrouter: {
        baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", baseURLEnv: "OPENROUTER_BASE_URL",
        headers: { "HTTP-Referer": "http://localhost:3000", "X-Title": "mini-pi-agent" },
    },
    deepseek:   { baseURL: "https://api.deepseek.com",     apiKeyEnv: "DEEPSEEK_API_KEY",   baseURLEnv: "DEEPSEEK_BASE_URL" },
};

export function apiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
    // ① 决定 provider：没设置就用默认值。不要在这里抛错：没设 PROVIDER 是正常用法
    const provider = env.PROVIDER || DEFAULT_PROVIDER;
    // ② mock 不需要地址和 key，在查表之前直接返回
    if (provider === "mock") return { provider };
    // ③ 查表；查不到就用 OpenAI 兼容的默认值。`??` 同时让类型里去掉了 undefined
    const defaults = PROVIDERS[provider] ?? OPENAI_COMPATIBLE;
    // ④ 用表里的“变量名”去 env 里取值。地址：环境变量优先，没有再用默认地址
    const baseURL = (defaults.baseURLEnv && env[defaults.baseURLEnv]) || defaults.baseURL;
    const apiKey = env[defaults.apiKeyEnv];

    const config: ApiConfig = { provider, baseURL };
    if (apiKey) config.apiKey = apiKey;

    // ⑤ openrouter 的请求头默认值在表里，createApi 总会带上；这里只处理环境变量的覆盖
    //   （对应 pi 单独处理 anthropic 的做法）
    if (provider === "openrouter") {
        const headers: Record<string, string> = {};
        if (env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = env.OPENROUTER_HTTP_REFERER;
        if (env.OPENROUTER_APP_TITLE) headers["X-Title"] = env.OPENROUTER_APP_TITLE;
        if (Object.keys(headers).length > 0) config.headers = headers;
    }
    return config;
}

/** Build the configured model API without choosing a model for the caller. */
export function createApi(config: ApiConfig = apiConfigFromEnv()): Api {
    switch (config.provider) {
        case "mock":
            return createMockApi();
        default: {
            const defaults = PROVIDERS[config.provider] ?? OPENAI_COMPATIBLE;

            const apiKey = config.apiKey;
            if (!apiKey) {
                throw new Error(`${defaults.apiKeyEnv} 未设置（PROVIDER=${config.provider}）`);
            }
            // 走到这里，TypeScript 已经知道 apiKey 是 string 了（类型收窄）

            return createOpenAiApi({
                name: config.provider,
                baseURL: config.baseURL ?? defaults.baseURL,   // 用 ?? 补上默认值后，类型就是 string
                apiKey,
                // 表里的默认头 + 调用方的头（同名时调用方优先）
                headers: { ...defaults.headers, ...config.headers },
            });
        }
    }
}

/** @deprecated Use createApi(). */
export const CreateApi = createApi;
