// The message-centre proxies versus closed-network mode.
//
// Both routes forward to Open Design Cloud's message centre — a hosted
// announcement feed, the same family as the What's New document the mode
// already refuses. The renderer stops polling it, and this is the other half:
// any caller (the CLI, an embedding agent, a stale renderer) gets a refusal by
// policy rather than a hang or a proxy's 403.
//
// The claim is "no socket is opened", so the assertions check that the handler
// returned before it did any work at all — `readAppConfig` is the first thing
// past the guard, so a call to it means the guard did not hold.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerVelaRoutes } from '../../src/routes/vela.js';

const PUBLIC_FEED = '/api/integrations/vela/message-center-public/messages';
const ACCOUNT_FEED = '/api/integrations/vela/message-center/messages';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function startApp(closedNetwork: boolean) {
  const readAppConfig = vi.fn(async () => ({}));
  const app = express();
  app.use(express.json());
  registerVelaRoutes(app, {
    paths: { RUNTIME_DATA_DIR: process.cwd() },
    appConfig: { readAppConfig: readAppConfig as never },
    http: {},
    closedNetwork,
    env: {},
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, readAppConfig };
}

describe('vela message-centre routes in closed-network mode', () => {
  for (const [label, route] of [
    ['the anonymous feed', PUBLIC_FEED],
    ['the account feed', ACCOUNT_FEED],
  ] as const) {
    it(`refuses ${label} with a machine-readable 503`, async () => {
      const { baseUrl, readAppConfig } = await startApp(true);

      const response = await fetch(`${baseUrl}${route}?locale=en-US`);
      const body = (await response.json()) as { error?: string; message?: string };

      // 503 + the code, not 502: a caller must be able to tell "policy says no"
      // apart from the upstream being down. Matches the mapper in
      // open-design-public-metadata.ts.
      expect(response.status).toBe(503);
      expect(body.error).toBe('closed-network');
      expect(body.message).toContain('closed-network mode');
      expect(readAppConfig).not.toHaveBeenCalled();
    });
  }

  it('leaves the routes alone when the mode is off', async () => {
    const { baseUrl, readAppConfig } = await startApp(false);

    const response = await fetch(`${baseUrl}${PUBLIC_FEED}?locale=en-US`);

    // The upstream is unreachable from this test, so the status is whatever the
    // proxy makes of that. What matters is that the guard did not intercept.
    expect(response.status).not.toBe(503);
    expect(readAppConfig).toHaveBeenCalled();
  });
});
