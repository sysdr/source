import { afterEach, describe, expect, it } from 'vitest';
import type http from 'node:http';
import { createServer } from './index';

let activeServer: http.Server | null = null;

const startServer = async () => {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  activeServer = server;
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Could not resolve test server address');
  }
  return `http://127.0.0.1:${addr.port}`;
};

afterEach(async () => {
  if (!activeServer) return;
  await new Promise<void>((resolve, reject) => {
    activeServer?.close((err) => (err ? reject(err) : resolve()));
  });
  activeServer = null;
  delete process.env.SUEZ_API_KEY;
  delete process.env.CORS_ORIGINS;
  delete process.env.RATE_LIMIT_MAX;
  delete process.env.MAX_BODY_BYTES;
});

describe('server API', () => {
  it('returns health payload without auth', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(typeof json.ts).toBe('string');
  });

  it('returns 401 for orchestrator when auth fails', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: 'hello' }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when userMessage is missing', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'secret-key',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'userMessage required' });
  });

  it('blocks disallowed browser origins', async () => {
    process.env.CORS_ORIGINS = 'http://allowed.test';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://blocked.test' },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Origin not allowed' });
  });

  it('applies orchestrator rate limit', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    process.env.RATE_LIMIT_MAX = '1';
    const baseUrl = await startServer();
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': 'secret-key',
    };

    const first = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(400);

    const second = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toEqual({ error: 'Too many requests' });
  });

  it('returns 413 for oversized payloads', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    process.env.MAX_BODY_BYTES = '10';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'secret-key',
      },
      body: JSON.stringify({ userMessage: 'this request body is too large for limit' }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'Payload too large' });
  });
});
