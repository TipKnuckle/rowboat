import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_ASSISTANT_IDENTITY } from '@x/shared/dist/assistant-identity.js';

const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('./config.js', () => ({ get WorkDir() { return state.directory; } }));
state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-identity-'));
const { getAssistantIdentity, saveAssistantIdentity } = await import('./assistant-identity.js');
beforeEach(async () => { await fs.rm(path.join(state.directory, 'config'), { recursive: true, force: true }); });
afterAll(async () => { await fs.rm(state.directory, { recursive: true, force: true }); });

it('uses upstream defaults until configured, then persists trimmed settings including blank personality', async () => {
    expect(await getAssistantIdentity()).toEqual(DEFAULT_ASSISTANT_IDENTITY);
    await saveAssistantIdentity({ name: ' Merlin ', personality: ' ' });
    expect(await getAssistantIdentity()).toEqual({ name: 'Merlin', personality: '' });
    expect(await fs.readdir(path.join(state.directory, 'config'))).toEqual(['assistant-identity.json']);
});

it('rejects invalid names and oversized personalities without replacing saved settings', async () => {
    await saveAssistantIdentity({ name: 'Merlin', personality: 'Be concise.' });
    for (const invalid of [{ name: '', personality: '' }, { name: 'two\nlines', personality: '' }, { name: 'Merlin', personality: 'x'.repeat(4001) }]) {
        await expect(saveAssistantIdentity(invalid)).rejects.toThrow();
    }
    expect(await getAssistantIdentity()).toEqual({ name: 'Merlin', personality: 'Be concise.' });
});

it('surfaces malformed configuration instead of silently replacing it with defaults', async () => {
    await saveAssistantIdentity({ name: 'Merlin', personality: '' });
    await fs.writeFile(path.join(state.directory, 'config/assistant-identity.json'), '{');
    await expect(getAssistantIdentity()).rejects.toThrow();
});
