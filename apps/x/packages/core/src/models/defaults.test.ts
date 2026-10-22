import { describe, expect, it, vi } from 'vitest';

// The setting decides when background work may touch the model, so its
// resolution rules are worth pinning: "off" and "immediate" are different
// behaviors, and an existing preference has to survive the rename.

const fake = vi.hoisted(() => ({ config: null as Record<string, unknown> | null }));

vi.mock('../di/container.js', () => ({
    default: {
        resolve: () => ({ getConfig: async () => fake.config }),
    },
}));

import { getBackgroundQuietPeriodMs, getBackgroundScheduling } from './defaults.js';

describe('backgroundScheduling resolution', () => {
    it('is off with nothing stored, so background work behaves exactly as before', async () => {
        fake.config = null;
        expect(await getBackgroundScheduling()).toBe('off');
        expect(await getBackgroundQuietPeriodMs()).toBeNull();

        fake.config = { version: 2, providers: {} };
        expect(await getBackgroundScheduling()).toBe('off');
        expect(await getBackgroundQuietPeriodMs()).toBeNull();
    });

    it('maps the legacy defer flag to immediate, not to a duration', async () => {
        // The old checkbox waited for the chat to finish and then released
        // everything at once. Its faithful successor is immediate with a zero
        // quiet period — turning it into "30s" would silently change behavior.
        fake.config = { version: 2, providers: {}, deferBackgroundTasks: true };
        expect(await getBackgroundScheduling()).toBe('immediate');
        expect(await getBackgroundQuietPeriodMs()).toBe(0);

        fake.config = { version: 2, providers: {}, deferBackgroundTasks: false };
        expect(await getBackgroundScheduling()).toBe('off');
    });

    it('an explicit setting outranks the legacy flag', async () => {
        fake.config = {
            version: 2,
            providers: {},
            deferBackgroundTasks: true,
            backgroundScheduling: '5m',
        };
        expect(await getBackgroundScheduling()).toBe('5m');
        expect(await getBackgroundQuietPeriodMs()).toBe(300_000);
    });

    it('every duration resolves to its own quiet period', async () => {
        const expected: Array<[string, number]> = [
            ['immediate', 0],
            ['30s', 30_000],
            ['1m', 60_000],
            ['5m', 300_000],
            ['15m', 900_000],
        ];
        for (const [setting, ms] of expected) {
            fake.config = { version: 2, providers: {}, backgroundScheduling: setting };
            expect(await getBackgroundScheduling()).toBe(setting);
            expect(await getBackgroundQuietPeriodMs()).toBe(ms);
        }
    });
});
