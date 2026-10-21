import { describe, expect, it } from 'vitest';
import { parseLocalMailThread, readLocalMailThread } from './local-mail.js';

describe('local mail', () => {
    it('reads nested replies and plain text without rendering HTML or attachments', () => {
        const result = parseLocalMailThread([[{ id: 'parent', headers: { From: 'A', Subject: 'Hello' }, body: [
            { 'content-type': 'multipart/alternative', content: [
                { 'content-type': 'text/plain', content: 'Plain body' },
                { 'content-type': 'text/html', content: '<img src="https://remote.test/tracker">' },
            ] },
            { 'content-type': 'text/plain', filename: 'attachment.txt', content: 'Attachment contents' },
        ] }, [[{ id: 'reply', headers: { From: 'B' }, body: [{ 'content-type': 'text/plain', content: 'Reply' }] }, []]]]]);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ text: 'Plain body', attachments: ['attachment.txt'] });
        expect(result[1].text).toBe('Reply');
        expect(JSON.stringify(result)).not.toContain('remote.test');
        expect(JSON.stringify(result)).not.toContain('Attachment contents');
    });
    it('bounds message bodies and explains HTML-only messages', () => {
        expect(parseLocalMailThread([{ id: 'a', headers: {}, body: [{ 'content-type': 'text/plain', content: 'x'.repeat(60_000) }] }])[0].text).toHaveLength(50_020);
        expect(parseLocalMailThread([{ id: 'b', headers: {}, body: [] }])[0].text).toContain('No plain-text body');
    });
    it('rejects arbitrary commands or queries in thread IDs before spawning notmuch', async () => {
        await expect(readLocalMailThread('--output=files')).rejects.toThrow();
        await expect(readLocalMailThread('a; touch /tmp/unwanted')).rejects.toThrow();
    });
});
