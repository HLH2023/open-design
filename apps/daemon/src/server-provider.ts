import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

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

export interface PersistServerProviderInput {
  protocol: ServerProviderProtocol;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

const PROTOCOLS = new Set<ServerProviderProtocol>([
  'anthropic', 'openai', 'azure', 'google', 'ollama', 'senseaudio', 'aihubmix',
]);
const CONFIG_FILE = 'provider-config.json';
const KEY_FILE = 'provider-api-key';
const DISABLED_FILE = 'provider-config.disabled';

export function providerProtocolRequiresApiKey(protocol: ServerProviderProtocol): boolean {
  return protocol !== 'ollama';
}

function validateBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('invalid');
    if (url.username || url.password) throw new Error('invalid');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('baseUrl must be a valid http(s) URL');
  }
}

type ProviderMetadata = Pick<ServerProviderConfig, 'protocol' | 'baseUrl' | 'model'>;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pathsFor(dataDir: string) {
  return {
    config: join(dataDir, CONFIG_FILE),
    key: join(dataDir, KEY_FILE),
    disabled: join(dataDir, DISABLED_FILE),
  };
}

function readSecretFile(file: string): string {
  if (!file) return '';
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function readPersistedProvider(dataDir: string): ServerProviderConfig | null {
  if (!dataDir) return null;
  const paths = pathsFor(dataDir);
  if (existsSync(paths.disabled)) return null;
  try {
    const metadata = JSON.parse(readFileSync(paths.config, 'utf8')) as Partial<ProviderMetadata>;
    const protocol = clean(metadata.protocol) as ServerProviderProtocol;
    const baseUrl = clean(metadata.baseUrl);
    const model = clean(metadata.model);
    const apiKey = readSecretFile(paths.key);
    if (!PROTOCOLS.has(protocol) || !baseUrl || !model) return null;
    if (providerProtocolRequiresApiKey(protocol) && !apiKey) return null;
    return { protocol, baseUrl, model, apiKey, source: 'server' };
  } catch {
    return null;
  }
}

function writePrivateFile(file: string, content: string): void {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

export function loadServerProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
  dataDir?: string,
): ServerProviderConfig | null {
  const persisted = dataDir ? readPersistedProvider(dataDir) : null;
  if (persisted) return persisted;
  if (dataDir && existsSync(pathsFor(dataDir).disabled)) return null;

  const protocol = clean(env.OD_PROVIDER_PROTOCOL) as ServerProviderProtocol;
  const baseUrl = clean(env.OD_PROVIDER_BASE_URL);
  const model = clean(env.OD_PROVIDER_MODEL);
  // Server-side Provider credentials are file-only by design. Do not accept
  // an environment-variable key.
  const apiKey = readSecretFile(clean(env.OD_PROVIDER_API_KEY_FILE));
  if (!PROTOCOLS.has(protocol) || !baseUrl || !model) return null;
  if (providerProtocolRequiresApiKey(protocol) && !apiKey) return null;
  return { protocol, baseUrl, model, apiKey, source: 'server' };
}

export function publicServerProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
  dataDir?: string,
): PublicServerProviderConfig | null {
  const config = loadServerProviderConfig(env, dataDir);
  if (!config) return null;
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    model: config.model,
    configured: true,
    source: 'server',
  };
}

export function persistServerProviderConfig(
  dataDir: string,
  input: PersistServerProviderInput,
  env: NodeJS.ProcessEnv = process.env,
): PublicServerProviderConfig {
  const protocol = clean(input.protocol) as ServerProviderProtocol;
  let baseUrl = clean(input.baseUrl);
  const model = clean(input.model);
  if (!PROTOCOLS.has(protocol) || !baseUrl || !model) {
    throw new Error('protocol, baseUrl, and model are required');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error('baseUrl must be a valid absolute URL');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }
  baseUrl = validateBaseUrl(baseUrl);
  const existing = loadServerProviderConfig(env, dataDir);
  const apiKey = clean(input.apiKey)
    || (existing?.protocol === protocol ? existing.apiKey : '');
  if (providerProtocolRequiresApiKey(protocol) && !apiKey) {
    throw new Error('apiKey is required for this Provider');
  }

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const paths = pathsFor(dataDir);
  try { unlinkSync(paths.disabled); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (apiKey) writePrivateFile(paths.key, apiKey);
  else {
    try { unlinkSync(paths.key); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  writePrivateFile(paths.config, JSON.stringify({ protocol, baseUrl, model } satisfies ProviderMetadata));
  return { protocol, baseUrl, model, configured: true, source: 'server' };
}

export function deleteServerProviderConfig(dataDir: string): void {
  if (!dataDir) return;
  const paths = pathsFor(dataDir);
  for (const file of [paths.config, paths.key]) {
    try { unlinkSync(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writePrivateFile(paths.disabled, 'disabled');
}

export function hydrateServerProviderRequest(
  body: Record<string, unknown>,
  protocol: ServerProviderProtocol,
  env: NodeJS.ProcessEnv = process.env,
  dataDir?: string,
): Record<string, unknown> | null {
  const config = loadServerProviderConfig(env, dataDir);
  // Preserve an explicitly supplied key for backwards compatibility. The
  // Web settings path never sends one after server persistence succeeds.
  if (clean(body.apiKey)) return body;
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
