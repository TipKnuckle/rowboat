import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { LocalMailQuery, LocalMailThreadId, LocalMailSummary, LocalMailMessage } from '@x/shared/dist/local-mail.js';

const execute = promisify(execFile);

async function executable() {
    // Finder-launched apps do not inherit the user's Homebrew PATH.
    for (const file of ['/opt/homebrew/bin/notmuch', '/usr/local/bin/notmuch', '/usr/bin/notmuch']) {
        try { await fs.access(file, fs.constants.X_OK); return file; } catch { /* Try the next installation location. */ }
    }
    return 'notmuch';
}

async function run(args: string[]) {
    try {
        const { stdout } = await execute(await executable(), args, { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
        return stdout;
    } catch {
        throw new Error('Could not read the notmuch index. Check that notmuch is installed, configured, and accessible to Rowboat. Large threads may exceed the read limit.');
    }
}

export async function localMailStatus() {
    try {
        const [path, count] = await Promise.all([run(['config', 'get', 'database.path']), run(['count', '*'])]);
        return { available: true, path: path.trim(), count: Number(count.trim()) };
    } catch (error) { return { available: false, error: (error as Error).message }; }
}

export async function searchLocalMail(input: z.input<typeof LocalMailQuery>) {
    const { query, offset, limit } = LocalMailQuery.parse(input);
    const raw = await run(['search', '--format=json', '--sort=newest-first', `--offset=${offset}`, `--limit=${limit}`, '--', query.trim() || '*']);
    return z.array(LocalMailSummary).parse(JSON.parse(raw));
}

export function parseLocalMailThread(raw: unknown): z.infer<typeof LocalMailMessage>[] {
    const messages: z.infer<typeof LocalMailMessage>[] = [];
    function visit(value: unknown) {
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (!value || typeof value !== 'object') return;
        const message = value as Record<string, unknown>;
        if (typeof message.id !== 'string' || !message.headers || typeof message.headers !== 'object') return;
        const headers = message.headers as Record<string, unknown>;
        const text: string[] = [];
        const attachments: string[] = [];
        function parts(value: unknown) {
            if (Array.isArray(value)) { value.forEach(parts); return; }
            if (!value || typeof value !== 'object') return;
            const part = value as Record<string, unknown>;
            if (typeof part.filename === 'string') attachments.push(part.filename);
            else if (part['content-type'] === 'text/plain' && typeof part.content === 'string') text.push(part.content);
            if (Array.isArray(part.content)) parts(part.content);
        }
        parts(message.body);
        const header = (key: string) => typeof headers[key] === 'string' ? headers[key] as string : '';
        const body = text.join('\n\n');
        messages.push({ id: message.id, from: header('From'), to: header('To'), date: header('Date'), subject: header('Subject'),
            text: body ? body.slice(0, 50_000) + (body.length > 50_000 ? '\n[Message truncated]' : '') : '[No plain-text body available. Open this message in your mail client.]', attachments });
    }
    visit(raw);
    return messages;
}

export async function readLocalMailThread(thread: string) {
    const id = LocalMailThreadId.parse(thread);
    const raw = await run(['show', '--format=json', '--body=true', '--include-html=false', '--entire-thread=true', '--', `thread:${id}`]);
    return parseLocalMailThread(JSON.parse(raw));
}
