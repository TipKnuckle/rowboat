import { z } from 'zod';
import { ToolInventory } from '@x/shared/dist/tool-inventory.js';
import { BuiltinTools } from './catalog.js';
import { COPILOT_BASE_TOOLS } from '../assembly/copilot/base-tools.js';
import { availableSkills, skillToolNames } from '../assembly/skills/index.js';
import { listServers, listTools } from '../../mcp/mcp.js';

export async function getToolInventory(includeMcp: boolean): Promise<z.infer<typeof ToolInventory>> {
    const notices: string[] = [];
    const tools = await Promise.all(Object.entries(BuiltinTools).map(async ([name, tool]) => {
        let available = true;
        try { available = tool.isAvailable ? await tool.isAvailable() : true; }
        catch { available = false; }
        let inputSchema = '';
        try { inputSchema = JSON.stringify(z.toJSONSchema(tool.inputSchema), null, 2); } catch { inputSchema = 'Schema not available'; }
        return { name, description: tool.description, source: 'Built-in', permission: tool.permission,
            available, activation: COPILOT_BASE_TOOLS.includes(name) ? 'Base assistant tool' : 'Loaded by a skill or agent',
            skills: availableSkills.filter(skill => skillToolNames(skill).includes(name)), inputSchema };
    }));
    tools.push({ name: 'ask-human', description: 'Ask a question and wait for your reply.', source: 'Runtime',
        permission: 'none', available: true, activation: 'Interactive chats only', skills: [],
        inputSchema: JSON.stringify({ question: 'string (required)', options: 'string[] (optional, up to four)', multiSelect: 'boolean (optional)' }, null, 2) });
    if (includeMcp) {
        const servers = await listServers();
        await Promise.all(Object.keys(servers.mcpServers).map(async server => {
            try {
                let cursor: string | undefined;
                const seen = new Set<string>();
                do {
                    const page = await listTools(server, cursor);
                    for (const tool of page.tools) tools.push({ name: tool.name, description: tool.description ?? '',
                        source: `MCP: ${server}`, permission: 'mcp-execute', available: true,
                        activation: 'MCP discovery or agent attachment', skills: [], inputSchema: JSON.stringify(tool.inputSchema, null, 2) });
                    cursor = page.nextCursor;
                    if (cursor && seen.has(cursor)) throw new Error('Repeated cursor');
                    if (cursor) seen.add(cursor);
                } while (cursor);
            } catch { notices.push(`Could not finish listing tools for MCP server ${server}. Check its connection in Settings → MCP Servers.`); }
        }));
    } else notices.push('MCP tools have not been loaded. Load connected tools to contact your configured servers.');
    notices.push('Availability reflects configuration, not a guarantee that credentials or services work. Individual chats can expose a smaller tool set. Composio tools are discovered on demand through its search tool.');
    return { tools: tools.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name)), notices };
}
