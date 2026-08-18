import { readFileSync } from 'node:fs';

export type ServerProviderProtocol =
  | 'anthropic'
  | 'openai'
  | 'azure'
  | 'google'
  | 'ollama'
  | 'senseaudio'
  | 'aihubmix';

export interface ServerProviderConfig {
  protocol: ServerProviderProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  source: 'server';
}

export interface PublicServerProviderConfig {
  protocol: ServerProviderProtocol;
  baseUrl: string;
  model: string;
  configured: boolean;
  source: 'server';
}

const PROTOCOLS = new Set<ServerProviderProtocol>([
  'anthropic', 'openai', 'azure', 'google', 'ollama', 'senseaudio', 'aihubmix',
]);

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readSecretFile(file: string): string {
  if (!file) return '';
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

export function loadServerProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerProviderConfig | null {
  const protocol = clean(env.OD_PROVIDER_PROTOCOL) as ServerProviderProtocol;
  const baseUrl = clean(env.OD_PROVIDER_BASE_URL);
  const model = clean(env.OD_PROVIDER_MODEL);
  // Server-side Provider credentials are file-only by design. Do not accept
  // an environment-variable key: compose/system inspection and child-process
  // diagnostics can expose environment values.
  const apiKey = readSecretFile(clean(env.OD_PROVIDER_API_KEY_FILE));
  if (!PROTOCOLS.has(protocol) || !baseUrl || !model || !apiKey) return null;
  return { protocol, baseUrl, model, apiKey, source: 'server' };
}

export function publicServerProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublicServerProviderConfig | null {
  const config = loadServerProviderConfig(env);
  if (!config) return null;
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    model: config.model,
    configured: true,
    source: 'server',
  };
}

export function hydrateServerProviderRequest(
  body: Record<string, unknown>,
  protocol: ServerProviderProtocol,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | null {
  if (clean(body.apiKey)) return body;
  const config = loadServerProviderConfig(env);
  if (!config || config.protocol !== protocol) return null;
  return {
    ...body,
    baseUrl: config.baseUrl,
    model: clean(body.model) || config.model,
    apiKey: config.apiKey,
  };
}

export function redactServerProviderConfig(
  config: ServerProviderConfig | null,
): PublicServerProviderConfig | null {
  if (!config) return null;
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    model: config.model,
    configured: true,
    source: 'server',
  };
}
