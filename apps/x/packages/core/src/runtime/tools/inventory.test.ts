import { z } from 'zod';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ listServers: vi.fn(), listTools: vi.fn() }));
vi.mock('./catalog.js', () => ({ BuiltinTools: {
    read: { description: 'Read', permission: 'none', inputSchema: z.object({ path: z.string() }) },
    unavailable: { description: 'Unavailable', permission: 'prompt', inputSchema: z.object({}), isAvailable: async () => { throw new Error('not configured') } },
} }));
vi.mock('../assembly/copilot/base-tools.js', () => ({ COPILOT_BASE_TOOLS: ['read'] }));
vi.mock('../assembly/skills/index.js', () => ({ availableSkills: ['reader'], skillToolNames: () => ['read'] }));
vi.mock('../../mcp/mcp.js', () => mocks);
const { getToolInventory } = await import('./inventory.js');
beforeEach(() => { vi.clearAllMocks() });
it('lists runtime and unavailable tools without contacting MCP by default', async () => {
    const result = await getToolInventory(false);
    expect(result.tools).toHaveLength(3);
    expect(result.tools.find(tool => tool.name === 'ask-human')).toMatchObject({ permission: 'none', source: 'Runtime' });
    expect(result.tools.find(tool => tool.name === 'unavailable')).toMatchObject({ available: false });
    expect(result.tools.find(tool => tool.name === 'read')).toMatchObject({ skills: ['reader'], activation: 'Base assistant tool' });
    expect(mocks.listServers).not.toHaveBeenCalled();
});
it('collects paginated MCP tools and reports failing servers without exposing config secrets', async () => {
    mocks.listServers.mockResolvedValue({ mcpServers: { good: { config: { headers: { Authorization: 'secret' } } }, broken: {} } });
    mocks.listTools.mockImplementation(async (server, cursor) => {
        if (server === 'broken') throw new Error('secret');
        return { tools: [{ name: cursor ? 'second' : 'first', inputSchema: { type: 'object' } }], nextCursor: cursor ? undefined : 'page2' };
    });
    const result = await getToolInventory(true);
    expect(result.tools.filter(tool => tool.source === 'MCP: good')).toHaveLength(2);
    expect(result.notices.some(notice => notice.includes('broken'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
});
