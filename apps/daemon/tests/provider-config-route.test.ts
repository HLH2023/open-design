import http from 'node:http';
import express from 'express';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerChatRoutes } from '../src/routes/chat.js';

const REDACTED_KEY = '[REDACTED]';
let server: http.Server | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  if (server) {
    const current = server;
    server = null;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = null;
  }
});

function routeContext() {
  return {
    db: {},
    design: { runs: { get: () => null } },
    http: {
      createSseResponse: () => ({ send: () => true, end: () => undefined }),
      sendApiError: (res: express.Response, status: number, code: string, message: string) =>
        res.status(status).json({ error: code, message }),
      isLocalSameOrigin: (req: express.Request) => req.headers.origin !== 'https://evil.example',
      resolvedPortRef: { current: 7456 },
    },
    paths: { RUNTIME_DATA_DIR: dataDir },
    chat: {},
    agents: {},
    critique: {
      critiqueArtifactsRoot: '/tmp/unused',
      critiqueResponseCapBytes: 1024,
      critiqueRunRegistry: {},
      handleCritiqueArtifact: () => (_req: express.Request, res: express.Response) => res.sendStatus(404),
      handleCritiqueInterrupt: () => (_req: express.Request, res: express.Response) => res.sendStatus(404),
    },
    appConfig: { readAppConfig: async () => ({}) },
    validation: {},
    lifecycle: { isDaemonShuttingDown: () => false },
    telemetry: { reportFeedback: vi.fn() },
    authorizeProjectRequest: vi.fn(),
  } as any;
}

async function startRouteServer() {
  const app = express();
  app.use(express.json());
  registerChatRoutes(app, routeContext());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

describe('provider config API', () => {
  it('supports sanitized CRUD and survives a new daemon route instance', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'od-provider-route-'));
    const base = await startRouteServer();

    expect((await fetch(`${base}/api/provider/config`)).status).toBe(200);
    expect(await (await fetch(`${base}/api/provider/config`)).json()).toEqual({ provider: null });

    const invalid = await fetch(`${base}/api/provider/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 'openai', baseUrl: 'not-a-url', model: 'model-a', apiKey: REDACTED_KEY }),
    });
    expect(invalid.status).toBe(400);

    const invalidProtocol = await fetch(`${base}/api/provider/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 'openai', baseUrl: 'ftp://provider.example/v1', model: 'model-a', apiKey: REDACTED_KEY }),
    });
    expect(invalidProtocol.status).toBe(400);

    const saved = await fetch(`${base}/api/provider/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 'openai', baseUrl: 'https://provider.example/v1', model: 'model-a', apiKey: REDACTED_KEY }),
    });
    expect(saved.status).toBe(200);
    const savedText = await saved.text();
    expect(savedText).not.toContain(REDACTED_KEY);
    expect(JSON.parse(savedText)).toEqual({
      provider: {
        protocol: 'openai',
        baseUrl: 'https://provider.example/v1',
        model: 'model-a',
        configured: true,
        source: 'server',
      },
    });

    const metadata = JSON.parse(readFileSync(join(dataDir, 'provider-config.json'), 'utf8')) as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('apiKey');
    expect(readFileSync(join(dataDir, 'provider-api-key'), 'utf8').trim()).toBe(REDACTED_KEY);
    expect(statSync(join(dataDir, 'provider-api-key')).mode & 0o777).toBe(0o600);

    const updated = await fetch(`${base}/api/provider/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 'openai', baseUrl: 'https://provider.example/v2', model: 'model-b' }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json() as { provider?: Record<string, unknown> };
    expect(updatedBody.provider).toMatchObject({ baseUrl: 'https://provider.example/v2', model: 'model-b' });

    if (server) { const current = server; server = null; await new Promise<void>((resolve) => current.close(() => resolve())); }
    const restartedBase = await startRouteServer();
    const restored = await fetch(`${restartedBase}/api/provider/config`);
    const restoredText = await restored.text();
    expect(restoredText).not.toContain(REDACTED_KEY);
    expect(JSON.parse(restoredText).provider).toMatchObject({ baseUrl: 'https://provider.example/v2', model: 'model-b', configured: true });

    const deleted = await fetch(`${restartedBase}/api/provider/config`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ provider: null });
    expect(readFileSync(join(dataDir!, 'provider-config.disabled'), 'utf8').trim()).toBe('disabled');
    const afterDelete = await fetch(`${restartedBase}/api/provider/config`);
    const afterDeleteText = await afterDelete.text();
    expect(afterDeleteText).not.toContain(REDACTED_KEY);
    expect(JSON.parse(afterDeleteText)).toEqual({ provider: null });

    const reSaved = await fetch(`${restartedBase}/api/provider/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 'openai', baseUrl: 'https://provider.example/v3', model: 'model-c', apiKey: REDACTED_KEY }),
    });
    expect(reSaved.status).toBe(200);
    expect(await (await fetch(`${restartedBase}/api/provider/config`)).json()).toMatchObject({ provider: { baseUrl: 'https://provider.example/v3', configured: true } });
  });

  it('rejects cross-origin requests without exposing or changing configuration', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'od-provider-origin-'));
    const base = await startRouteServer();
    const response = await fetch(`${base}/api/provider/config`, { headers: { origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(REDACTED_KEY);
  });
});
