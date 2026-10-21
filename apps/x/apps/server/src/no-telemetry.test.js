import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { desktopBundleDefines } from '../../main/bundle-config.mjs';
import { ipc } from '@x/shared';

const root = fileURLToPath(new URL('../../../', import.meta.url));
afterEach(() => vi.unstubAllEnvs());

it('does not ship telemetry SDKs or accept tracking credentials at build time', () => {
  for (const area of ['apps/main', 'apps/renderer', 'apps/mobile', 'apps/server', 'packages/core']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, area, 'package.json'), 'utf8'));
    const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(dependencies.filter(name => /posthog|sentry|mixpanel|amplitude|segment\/analytics/i.test(name))).toEqual([]);
  }
  vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'must-not-be-embedded');
  vi.stubEnv('VITE_PUBLIC_POSTHOG_HOST', 'https://tracking.invalid');
  expect(desktopBundleDefines('1.2.3')).toEqual({ 'process.env.ROWBOAT_APP_VERSION': '"1.2.3"' });
});

it('has no tracking bootstrap or opt-in IPC channels', () => {
  for (const channel of ['analytics:bootstrap', 'app:getTelemetrySettings', 'app:setTelemetrySettings']) {
    expect(ipc.ipcSchemas).not.toHaveProperty(channel);
  }
});
