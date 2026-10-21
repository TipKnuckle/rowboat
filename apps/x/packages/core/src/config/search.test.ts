import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ directory: '', signedIn: false }));
vi.mock('./config.js', () => ({ get WorkDir() { return state.directory; } }));
vi.mock('../account/account.js', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('../auth/tokens.js', () => ({ getAccessToken: async () => 'gateway-token' }));
state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-search-'));
const { getSearchSettings, saveSearchSettings, searchWeb } = await import('./search.js');

beforeEach(async () => {
    state.signedIn = false;
    vi.unstubAllGlobals();
    await fs.rm(path.join(state.directory, 'config'), { recursive: true, force: true });
    await fs.mkdir(path.join(state.directory, 'config'));
});
afterAll(async () => { vi.unstubAllGlobals(); await fs.rm(state.directory, { recursive: true, force: true }); });

describe('search providers', () => {
    it('preserves legacy Exa keys and prefers them over the signed-in proxy', async () => {
        state.signedIn = true;
        await fs.writeFile(path.join(state.directory, 'config/exa-search.json'), JSON.stringify({ apiKey: 'legacy' }));
        expect(await getSearchSettings()).toMatchObject({ provider: 'exa', available: true });
        await saveSearchSettings({ provider: 'tavily', keys: { tavily: 'new-key' } });
        expect(await getSearchSettings()).toMatchObject({ configured: { exa: true, tavily: true } });
        expect(JSON.stringify(await getSearchSettings())).not.toContain('new-key');
        expect((await fs.stat(path.join(state.directory, 'config/search.json'))).mode & 0o777).toBe(0o600);
    });
    it.each([
        ['tavily', { results: [{ title: 'Found', url: 'https://example.com', content: 'Useful text' }] }, 'https://api.tavily.com/search'],
        ['firecrawl', { success: true, data: { web: [{ title: 'Found', url: 'https://example.com', description: 'Useful text' }] } }, 'https://api.firecrawl.dev/v2/search'],
        ['exa', { results: [{ title: 'Found', url: 'https://example.com', text: 'Useful text' }] }, 'https://api.exa.ai/search'],
    ] as const)('routes %s directly and normalizes results', async (provider, response, endpoint) => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
        vi.stubGlobal('fetch', fetcher);
        state.signedIn = true;
        await saveSearchSettings({ provider, keys: { [provider]: 'own-key' } });
        expect(await searchWeb({ query: 'hello' })).toMatchObject({ success: true, provider, count: 1, results: [{ text: 'Useful text' }] });
        expect(fetcher.mock.calls[0][0]).toBe(endpoint);
        const request = fetcher.mock.calls[0][1];
        expect(JSON.stringify(request.headers)).toContain('own-key');
        expect(JSON.stringify(request.headers)).not.toContain('gateway-token');
    });
    it('does not use another provider when disabled, unconfigured, or rejected', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('secret own-key', { status: 401 }));
        vi.stubGlobal('fetch', fetcher);
        await saveSearchSettings({ provider: 'disabled', keys: { exa: 'own-key' } });
        expect((await searchWeb({ query: 'hello' })).success).toBe(false);
        await saveSearchSettings({ provider: 'tavily' });
        expect((await searchWeb({ query: 'hello' })).success).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
        await saveSearchSettings({ provider: 'exa' });
        const failed = await searchWeb({ query: 'hello' });
        expect(failed).toMatchObject({ success: false });
        expect(JSON.stringify(failed)).not.toContain('own-key');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('removes keys explicitly and reports malformed responses', async () => {
        await saveSearchSettings({ provider: 'tavily', keys: { tavily: 'key' } });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
        expect(await searchWeb({ query: 'hello' })).toMatchObject({ success: false });
        await saveSearchSettings({ provider: 'tavily', keys: { tavily: '' } });
        expect(await getSearchSettings()).toMatchObject({ available: false, configured: { tavily: false } });
    });
});
