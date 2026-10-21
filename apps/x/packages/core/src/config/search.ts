import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { SearchSettingsUpdate, SearchSelection } from '@x/shared/dist/search-settings.js';
import { WorkDir } from './config.js';
import { API_URL } from './env.js';
import { isSignedIn } from '../account/account.js';
import { getAccessToken } from '../auth/tokens.js';

const configPath = path.join(WorkDir, 'config', 'search.json');
const Config = SearchSettingsUpdate.extend({ keys: z.object({ exa: z.string(), tavily: z.string(), firecrawl: z.string() }) });
type Config = z.infer<typeof Config>;
export type SearchInput = { query: string; numResults?: number; category?: string; provider?: z.infer<typeof SearchSelection> };

async function readConfig(): Promise<Config> {
    try { return Config.parse(JSON.parse(await fs.readFile(configPath, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Search settings could not be read. Check config/search.json.'); }
    let exa = '';
    try {
        const legacy = JSON.parse(await fs.readFile(path.join(WorkDir, 'config', 'exa-search.json'), 'utf8'));
        if (typeof legacy.apiKey === 'string') exa = legacy.apiKey.trim();
    } catch { /* Existing installations may not have an Exa key. */ }
    return { provider: exa ? 'exa' : await isSignedIn() ? 'rowboat' : 'disabled', keys: { exa, tavily: '', firecrawl: '' } };
}

export async function getSearchSettings() {
    const config = await readConfig();
    const rowboatAvailable = await isSignedIn();
    const configured = { exa: !!config.keys.exa, tavily: !!config.keys.tavily, firecrawl: !!config.keys.firecrawl };
    return { provider: config.provider, configured, rowboatAvailable,
        available: config.provider === 'disabled' ? false : config.provider === 'rowboat' ? rowboatAvailable : configured[config.provider] };
}

export async function saveSearchSettings(input: z.infer<typeof SearchSettingsUpdate>) {
    const update = SearchSettingsUpdate.parse(input);
    const current = await readConfig();
    const config = Config.parse({ provider: update.provider, keys: { ...current.keys, ...update.keys } });
    for (const key of Object.keys(config.keys) as Array<keyof Config['keys']>) config.keys[key] = config.keys[key].trim();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const temporary = `${configPath}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
        await fs.rename(temporary, configPath);
    } finally { await fs.rm(temporary, { force: true }); }
    return getSearchSettings();
}

const Result = z.object({
    title: z.string().optional(), url: z.string(), publishedDate: z.string().optional(),
    author: z.string().optional(), highlights: z.array(z.string()).optional(), text: z.string().optional(),
    content: z.string().optional(), description: z.string().optional(), markdown: z.string().optional(),
});
const Results = z.array(Result);

export async function searchWeb(input: SearchInput) {
    try {
        const config = await readConfig();
        const provider = input.provider ?? config.provider;
        if (provider === 'disabled') throw new Error('Web search is disabled. Choose a provider in Settings → Search.');
        const query = input.query.trim();
        if (!query) throw new Error('Enter a search query.');
        const limit = Math.min(20, Math.max(1, Math.floor(input.numResults || 5)));
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        let url: string;
        let body: Record<string, unknown>;
        if (provider === 'rowboat' || provider === 'exa') {
            body = { query, numResults: limit, type: 'auto', contents: { text: { maxCharacters: 1000 }, highlights: true } };
            if (input.category && input.category !== 'general') body.category = input.category;
            if (provider === 'rowboat') {
                if (!(await isSignedIn())) throw new Error('Sign in to use Rowboat search, or select your own provider in Settings → Search.');
                url = `${API_URL}/v1/search/exa`;
                headers.Authorization = `Bearer ${await getAccessToken()}`;
            } else {
                url = 'https://api.exa.ai/search';
                headers['x-api-key'] = config.keys.exa;
            }
        } else if (provider === 'tavily') {
            url = 'https://api.tavily.com/search';
            headers.Authorization = `Bearer ${config.keys.tavily}`;
            body = { query, max_results: limit, search_depth: 'basic', include_answer: false, topic: input.category === 'news' ? 'news' : 'general' };
        } else {
            url = 'https://api.firecrawl.dev/v2/search';
            headers.Authorization = `Bearer ${config.keys.firecrawl}`;
            body = { query, limit, sources: ['web'] };
        }
        if (provider !== 'rowboat' && !config.keys[provider]) throw new Error(`Configure ${provider} in Settings → Search first.`);
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
        // Provider error bodies can echo credentials; expose only the status.
        if (!response.ok) throw new Error(`${provider} search failed (HTTP ${response.status}). Check the key and provider quota in Settings → Search.`);
        const data = await response.json().catch(() => { throw new Error(`${provider} returned invalid JSON.`); });
        if (data.success === false) throw new Error(`${provider} could not complete the search.`);
        const parsed = Results.safeParse(provider === 'firecrawl' ? data.data?.web : data.results);
        if (!parsed.success) throw new Error(`${provider} returned an unexpected search response.`);
        const results = parsed.data.slice(0, limit).map(r => ({ title: r.title ?? '', url: r.url,
            publishedDate: r.publishedDate ?? '', author: r.author ?? '', highlights: r.highlights ?? [],
            text: (r.text ?? r.content ?? r.markdown ?? r.description ?? '').slice(0, 4000) }));
        return { success: true as const, provider, query, results, count: results.length };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Search failed.' };
    }
}
