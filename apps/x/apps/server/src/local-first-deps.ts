import { getSearchSettings, saveSearchSettings, searchWeb } from '@x/core/dist/config/search.js';
import { getToolInventory } from '@x/core/dist/runtime/tools/inventory.js';
import { localMailStatus, searchLocalMail, readLocalMailThread } from '@x/core/dist/knowledge/email/local-mail.js';
import type { RpcHandlers } from './channels.js';
import { getAssistantIdentity, saveAssistantIdentity } from '@x/core/dist/config/assistant-identity.js';

// Both embedded and headless servers execute these against their own workdir.
// Remote clients must never substitute their local keys, tools, or mail index.
export const localFirstRpcHandlers = {
  'assistant:getIdentity': async () => getAssistantIdentity(),
  'assistant:saveIdentity': async args => saveAssistantIdentity(args),
  'search:getSettings': async () => getSearchSettings(),
  'search:saveSettings': async args => saveSearchSettings(args),
  'search:test': async args => {
    const result = await searchWeb({ query: 'web search', numResults: 1, provider: args.provider });
    return result.success ? { success: true, count: result.count } : result;
  },
  'tools:inventory': async args => getToolInventory(args.includeMcp),
  'localMail:status': async () => localMailStatus(),
  'localMail:search': async args => searchLocalMail(args),
  'localMail:read': async args => readLocalMailThread(args.thread),
} satisfies Pick<RpcHandlers, 'assistant:getIdentity' | 'assistant:saveIdentity' | 'search:getSettings' | 'search:saveSettings' | 'search:test' | 'tools:inventory' | 'localMail:status' | 'localMail:search' | 'localMail:read'>;
