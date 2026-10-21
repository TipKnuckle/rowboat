import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AssistantIdentity, DEFAULT_ASSISTANT_IDENTITY } from '@x/shared/dist/assistant-identity.js';
import { WorkDir } from './config.js';
import type { z } from 'zod';

const configPath = path.join(WorkDir, 'config', 'assistant-identity.json');

export async function getAssistantIdentity(): Promise<z.infer<typeof AssistantIdentity>> {
    try {
        return AssistantIdentity.parse(JSON.parse(await fs.readFile(configPath, 'utf8')));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_ASSISTANT_IDENTITY };
        throw error;
    }
}

export async function saveAssistantIdentity(input: z.infer<typeof AssistantIdentity>) {
    const identity = AssistantIdentity.parse(input);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const temporary = `${configPath}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
        await fs.rename(temporary, configPath);
    } finally {
        await fs.rm(temporary, { force: true });
    }
    return identity;
}
