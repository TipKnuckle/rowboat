import { z } from 'zod';

export const AssistantIdentity = z.object({
    name: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/, 'Use a single line for the name.'),
    personality: z.string().trim().max(4000),
});

export const DEFAULT_ASSISTANT_IDENTITY: z.infer<typeof AssistantIdentity> = {
    name: 'Assistant',
    personality: "Be direct, thoughtful, and practical. Use plain language, match the user's level of detail, and avoid forced enthusiasm or flattery.",
};
