import { z } from 'zod';

export const SearchProvider = z.enum(['exa', 'tavily', 'firecrawl']);
export const SearchSelection = z.enum(['exa', 'tavily', 'firecrawl', 'rowboat', 'disabled']);
export const SearchSettingsUpdate = z.object({
    provider: SearchSelection,
    keys: z.object({ exa: z.string().optional(), tavily: z.string().optional(), firecrawl: z.string().optional() }).optional(),
});
export const SearchSettingsStatus = z.object({
    provider: SearchSelection,
    configured: z.object({ exa: z.boolean(), tavily: z.boolean(), firecrawl: z.boolean() }),
    rowboatAvailable: z.boolean(),
    available: z.boolean(),
});
