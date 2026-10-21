import { z } from 'zod';

export const ToolInventoryEntry = z.object({
    name: z.string(), description: z.string(), source: z.string(),
    permission: z.string(), available: z.boolean(), activation: z.string(),
    skills: z.array(z.string()), inputSchema: z.string(),
});
export const ToolInventory = z.object({ tools: z.array(ToolInventoryEntry), notices: z.array(z.string()) });
