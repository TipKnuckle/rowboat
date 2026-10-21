import { z } from 'zod';

export const LocalMailQuery = z.object({ query: z.string().max(2000).default('*'), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) });
export const LocalMailThreadId = z.string().regex(/^[a-f0-9]{16}$/i);
export const LocalMailSummary = z.object({ thread: LocalMailThreadId, timestamp: z.number(), subject: z.string(), authors: z.string(), total: z.number(), tags: z.array(z.string()) });
export const LocalMailMessage = z.object({ id: z.string(), from: z.string(), to: z.string(), date: z.string(), subject: z.string(), text: z.string(), attachments: z.array(z.string()) });
export const LocalMailStatus = z.object({ available: z.boolean(), path: z.string().optional(), count: z.number().optional(), error: z.string().optional() });
