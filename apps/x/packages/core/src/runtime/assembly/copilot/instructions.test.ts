import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ identity: { name: 'Assistant', personality: 'Be direct.' } }));
vi.mock('../../../config/assistant-identity.js', () => ({ getAssistantIdentity: async () => ({ ...state.identity }) }));
vi.mock('../skills/index.js', () => ({ buildAvailableSkillCatalog: async () => 'Test skill catalog' }));
vi.mock('./runtime-context.js', () => ({ getRuntimeContext: () => ({}), getRuntimeContextPrompt: () => 'Test runtime context' }));
vi.mock('../connections.js', () => ({
    isComposioAvailable: async () => false, isCodeModeAvailable: async () => false,
    isSlackAvailable: async () => false, getActiveEmailProviderId: async () => null,
    isSpacesAvailable: async () => false,
}));
vi.mock('../../../composio/repo.js', () => ({ composioAccountsRepo: {} }));
vi.mock('../../../knowledge/sources/repo.js', () => ({ knowledgeSourcesRepo: {} }));
vi.mock('../../../apps/indexer.js', () => ({ listApps: async () => [] }));

import { buildCopilotInstructions, invalidateCopilotInstructionsCache } from './instructions.js';
beforeEach(() => {
    state.identity = { name: 'Assistant', personality: 'Be direct.' };
    invalidateCopilotInstructionsCache();
});

it('refreshes cached identity without changing the operational prompt', async () => {
    const before = await buildCopilotInstructions();
    state.identity = { name: 'Merlin', personality: 'Be terse. No pep talks.' };
    const after = await buildCopilotInstructions();
    expect(after).toContain('Your name is "Merlin".');
    expect(after).toContain('Be terse. No pep talks.');
    expect(after).not.toContain('Supportive thoroughness');
    expect(after).not.toContain('You are Rowboat Copilot');
    expect(after.split('## Interaction Style')[1]).toBe(before.split('## Interaction Style')[1]);
    expect(await buildCopilotInstructions()).toBe(after);
});

it('does not bring back the old personality when the user leaves it blank', async () => {
    state.identity.personality = '';
    const prompt = await buildCopilotInstructions();
    expect(prompt).toContain('No additional personality preferences.');
    expect(prompt).not.toContain('gentle humor');
});
