import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProviderConfig, persistProviderConfig, deleteProviderConfig } from '../../src/state/config';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Web Provider persistence client', () => {
  it('reads and writes only sanitized Provider metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (init?.method === 'PUT') {
        const body = String(init.body);
        expect(body).toContain('api-key-client');
        return new Response(JSON.stringify({ provider: {
          protocol: 'openai', baseUrl: 'https://provider.example/v1', model: 'model-a', configured: true, source: 'server',
        } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ provider: null }), { status: 200 });
      return new Response(JSON.stringify({ provider: {
        protocol: 'openai', baseUrl: 'https://provider.example/v1', model: 'model-a', configured: true, source: 'server',
      } }), { status: 200 });
    }) as typeof fetch;

    const saved = await persistProviderConfig({ protocol: 'openai', baseUrl: 'https://provider.example/v1', model: 'model-a', apiKey: 'api-key-client' });
    expect(saved.configured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('api-key-client');
    expect(await fetchProviderConfig()).toMatchObject({ protocol: 'openai', model: 'model-a', configured: true });
    await deleteProviderConfig();
    expect(calls.map((call) => call.init?.method ?? 'GET')).toEqual(['PUT', 'GET', 'DELETE']);
  });
});
