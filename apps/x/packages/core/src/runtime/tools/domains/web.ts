import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";
import { getSearchSettings, searchWeb } from "../../../config/search.js";

export const webSearchTools: z.infer<typeof BuiltinToolsSchema> = {
    'web-search': {
        permission: "none",
        description: 'Search the web using the provider selected in Settings. Returns titles, URLs, excerpts, and available metadata. Provider-specific categories may be treated as general search.',
        inputSchema: z.object({
            query: z.string().min(1).describe('The search query'),
            numResults: z.number().int().min(1).max(20).optional().describe('Number of results (default 5, max 20)'),
            category: z.enum(['general', 'company', 'research paper', 'news', 'tweet', 'personal site', 'financial report', 'people']).optional().describe('Optional category. Exa supports all categories; Tavily supports general and news; Firecrawl searches the web.'),
        }),
        isAvailable: async () => {
            try { return (await getSearchSettings()).available; } catch { return false; }
        },
        execute: searchWeb,
    },
};

export const fetchUrlTools: z.infer<typeof BuiltinToolsSchema> = {
    'fetch-url': {
        permission: "none",
        description: "Fetch an HTTP(S) URL and return the response body as text. Use this to pull data from web APIs or pages (e.g. a JSON endpoint) — especially in background tasks, which have no shell. GET by default; supports POST with a body. Returns { ok, status, statusText, body } (body truncated if very large). For JSON, parse the returned body.",
        inputSchema: z.object({
            url: z.string().describe('The http(s) URL to fetch.'),
            method: z.enum(['GET', 'POST']).optional().describe('HTTP method (default GET).'),
            headers: z.record(z.string(), z.string()).optional().describe('Optional request headers.'),
            body: z.string().optional().describe('Request body (for POST).'),
        }),
        execute: async ({ url, method, headers, body }: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
            try {
                const parsed = new URL(url);
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    return { ok: false, status: 0, error: 'Only http(s) URLs are allowed.' };
                }
                const m = (method || 'GET').toUpperCase();
                const res = await fetch(url, { method: m, headers, body: m === 'GET' || m === 'HEAD' ? undefined : body });
                let text = await res.text();
                const MAX = 200_000;
                const truncated = text.length > MAX;
                if (truncated) text = text.slice(0, MAX);
                return { ok: res.ok, status: res.status, statusText: res.statusText, body: text, truncated };
            } catch (e) {
                return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
};
