// Offline/intranet fork: route-level behavior of the OD_OFFLINE gate.
//
// tests/setup.ts forces OD_OFFLINE=0 for the rest of the suite (the upstream
// unit tests exercise online code paths against stubbed fetches); this file
// flips the gate back on around a real server boot and asserts the daemon
// answers the community/lookup endpoints without any external fetch, serves
// the vendored CDN tree at /vendor, and renders local placeholder images.

import type { Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

interface StartedServer {
  server: Server;
  url: string;
}

let server: Server | undefined;
let baseUrl = '';
let prevOffline: string | undefined;
let prevPosthogKey: string | undefined;

beforeEach(async () => {
  prevOffline = process.env.OD_OFFLINE;
  prevPosthogKey = process.env.POSTHOG_KEY;
  process.env.OD_OFFLINE = '1';
  // Prove the analytics gate wins even when a build carries a key.
  process.env.POSTHOG_KEY = 'phc_offline_test';
  const started = await startServer({ port: 0, returnServer: true }) as StartedServer;
  server = started.server;
  baseUrl = started.url;
});

afterEach(async () => {
  if (prevOffline === undefined) delete process.env.OD_OFFLINE;
  else process.env.OD_OFFLINE = prevOffline;
  if (prevPosthogKey === undefined) delete process.env.POSTHOG_KEY;
  else process.env.POSTHOG_KEY = prevPosthogKey;
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve(undefined);
    server.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
  });
  server = undefined;
});

describe('offline mode routes', () => {
  it('answers the GitHub star lookup with 204 instead of calling api.github.com', async () => {
    const res = await fetch(`${baseUrl}/api/github/open-design`);
    expect(res.status).toBe(204);
  });

  it('answers the latest-release lookup with 204', async () => {
    const res = await fetch(`${baseUrl}/api/github/open-design/releases/latest`);
    expect(res.status).toBe(204);
  });

  it('answers the Discord presence lookup with 204', async () => {
    const res = await fetch(`${baseUrl}/api/community/discord`);
    expect(res.status).toBe(204);
  });

  it('reports analytics disabled even when POSTHOG_KEY is set', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/config`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, key: null, host: null });
  });

  it('serves the vendored CDN tree at /vendor', async () => {
    const res = await fetch(`${baseUrl}/vendor/tailwindcss/tailwindcss.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
  });

  it('renders deterministic local placeholder SVGs', async () => {
    const res = await fetch(`${baseUrl}/vendor/placeholder/seed/hero-kitchen/300/200`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/svg\+xml/);
    const body = await res.text();
    expect(body).toContain('width="300"');
    expect(body).toContain('height="200"');

    const repeat = await fetch(`${baseUrl}/vendor/placeholder/seed/hero-kitchen/300/200`);
    expect(await repeat.text()).toBe(body);
  });
});
