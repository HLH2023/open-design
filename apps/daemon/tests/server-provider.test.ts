import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hydrateServerProviderRequest,
  loadServerProviderConfig,
  publicServerProviderConfig,
} from '../src/server-provider.js';

const temporaryProviderFiles: string[] = [];

afterEach(() => {
  // Vitest's temporary directory is disposable; retain no provider material
  // in the repository or test output.
  temporaryProviderFiles.length = 0;
});

function providerEnv(extra: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'od-provider-test-'));
  const file = join(dir, 'api-key');
  writeFileSync(file, '[REDACTED]', { mode: 0o600 });
  temporaryProviderFiles.push(file);
  return { ...extra, OD_PROVIDER_API_KEY_FILE: file };
}

describe('server provider configuration', () => {
  it('loads a configured provider without exposing the key publicly', () => {
    const env = providerEnv({
      OD_PROVIDER_PROTOCOL: 'openai',
      OD_PROVIDER_BASE_URL: 'https://provider.example/v1',
      OD_PROVIDER_MODEL: 'model-a',
    });
    const config = loadServerProviderConfig(env);
    expect(config?.apiKey).toBe('[REDACTED]');
    expect(publicServerProviderConfig(env)).toEqual({
      protocol: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'model-a',
      configured: true,
      source: 'server',
    });
    expect(JSON.stringify(publicServerProviderConfig(env))).not.toContain('[REDACTED]');
  });

  it('injects the server key only when the request omits a client key', () => {
    const env = providerEnv({
      OD_PROVIDER_PROTOCOL: 'anthropic',
      OD_PROVIDER_BASE_URL: 'https://provider.example/anthropic',
      OD_PROVIDER_MODEL: 'model-a',
    });
    expect(hydrateServerProviderRequest({ model: 'model-b' }, 'anthropic', env)).toEqual({
      model: 'model-b',
      baseUrl: 'https://provider.example/anthropic',
      apiKey: '[REDACTED]',
    });
    expect(hydrateServerProviderRequest({ apiKey: 'browser-key' }, 'anthropic', env)).toEqual({
      apiKey: 'browser-key',
    });
  });

  it('does not accept a Provider key from an environment variable', () => {
    expect(loadServerProviderConfig({
      OD_PROVIDER_PROTOCOL: 'openai',
      OD_PROVIDER_BASE_URL: 'https://provider.example/v1',
      OD_PROVIDER_MODEL: 'model-a',
      OD_PROVIDER_API_KEY: '[REDACTED]',
    })).toBeNull();
  });

  it('does not inject across protocols or incomplete configuration', () => {
    const env = providerEnv({
      OD_PROVIDER_PROTOCOL: 'openai',
      OD_PROVIDER_BASE_URL: 'https://provider.example/v1',
      OD_PROVIDER_MODEL: 'model-a',
    });
    expect(hydrateServerProviderRequest({}, 'anthropic', env)).toBeNull();
    expect(loadServerProviderConfig({ ...env, OD_PROVIDER_API_KEY_FILE: '/missing/provider-key' })).toBeNull();
  });
});
