import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ mode: 'child' }));
vi.mock('@x/server', () => ({ isRpcChannel: channel => ['search:getSettings', 'localMail:search', 'tools:inventory'].includes(channel) }));
vi.mock('../src/server-host.js', () => ({ serverHostMode: () => state.mode, whenServerReady: async () => ({ baseUrl: 'http://server.test', key: 'test-key' }) }));
const { shouldForwardChannel, forwardRpc } = await import('../src/rpc-forwarder.ts');
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); state.mode = 'child'; });

it('always routes migrated features remotely, including after switching modes', () => {
  vi.stubEnv('ROWBOAT_FORWARD_MIGRATED', '0');
  expect(shouldForwardChannel('localMail:search')).toBe(false);
  state.mode = 'remote';
  for (const name of ['search:getSettings', 'localMail:search', 'tools:inventory']) expect(shouldForwardChannel(name)).toBe(true);
  expect(shouldForwardChannel('server:connectRemote')).toBe(false);
});

it('propagates remote failures instead of returning local results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'server unavailable' } }), { status: 503 })));
  await expect(forwardRpc('search:getSettings', null)).rejects.toThrow('server unavailable');
});
