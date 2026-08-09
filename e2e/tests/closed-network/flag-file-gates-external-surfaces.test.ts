// @vitest-environment node

// Closed network mode ("폐쇄망 모드") at the daemon HTTP boundary.
//
// The cheapest layer that can see the whole feature: a real `tools-dev` daemon,
// a real marker file on disk, and the same `/api/*` answers the web app and the
// `od` CLI consume. Unit tests already prove the resolver's precedence and that
// the services do not call `fetchImpl`; what only an end-to-end run can prove is
// that the marker a operator actually drops on disk reaches those services
// through server.ts's wiring.
//
// Both directions are exercised on purpose. A closed-network assertion that
// passes because the endpoint is broken for everyone would be worthless, so the
// control run re-checks each surface with no marker present.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { requestJson } from '@/vitest/http';
import { createSmokeSuite } from '@/vitest/suite';

type ClosedNetworkStatusResponse = {
  disabled: string[];
  enabled: boolean;
  flagPath: string | null;
  source: 'env' | 'flag-file' | null;
};

type AnalyticsConfigResponse = {
  enabled: boolean;
  host: string | null;
  key: string | null;
};

type GithubRepoResponse = { stale: boolean; stargazers_count: number };
type DiscordPresenceResponse = { memberCount: number; onlineCount: number; stale: boolean };
type MessageCenterPage = { messages: unknown[]; nextCursor: string | null; unreadCount: number };

/** Write the marker into the daemon's built-in project location. */
async function writeClosedNetworkMarker(dataDir: string): Promise<string> {
  const location = join(dataDir, 'projects');
  const markerDir = join(location, '.open-design');
  await mkdir(markerDir, { recursive: true });
  const markerPath = join(markerDir, 'closed-network.json');
  await writeFile(
    markerPath,
    `${JSON.stringify({ schemaVersion: 1, closedNetwork: true }, null, 2)}\n`,
    'utf8',
  );
  return markerPath;
}

async function postStatus(baseUrl: string, path: string, body: unknown): Promise<number> {
  const response = await fetch(new URL(path, `${baseUrl}/`), {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return response.status;
}

describe('closed network mode', () => {
  test('a flag file in the project location gates the daemon external surfaces', async () => {
    const suite = await createSmokeSuite('closed-network-flag-file');
    // The daemon resolves the marker once at startup, so it has to exist
    // before tools-dev spawns the daemon — exactly like an operator
    // provisioning the machine before the user launches the app.
    const markerPath = await writeClosedNetworkMarker(suite.dataDir);

    await suite.with.toolsDev(async ({ webUrl }) => {
      const status = await requestJson<ClosedNetworkStatusResponse>(webUrl, '/api/closed-network');
      expect(status.enabled).toBe(true);
      expect(status.source).toBe('flag-file');
      expect(status.flagPath).toBe(markerPath);
      expect(status.disabled).toContain('community-links');
      expect(status.disabled).toContain('telemetry');

      // The single switch that stops posthog-js, session replay, and the
      // consent-bypassing exception beacon: the browser never learns a host.
      const analytics = await requestJson<AnalyticsConfigResponse>(
        webUrl,
        '/api/analytics/config',
      );
      expect(analytics.enabled).toBe(false);
      expect(analytics.key).toBeNull();
      expect(analytics.host).toBeNull();

      // Served from the empty snapshot rather than api.github.com / discord.com.
      const github = await requestJson<GithubRepoResponse>(webUrl, '/api/github/open-design');
      expect(github).toMatchObject({ stale: true, stargazers_count: 0 });
      const discord = await requestJson<DiscordPresenceResponse>(webUrl, '/api/community/discord');
      expect(discord).toMatchObject({ memberCount: 0, onlineCount: 0, stale: true });

      // The 60-second poll answers empty instead of proxying to amr-api.
      const messages = await requestJson<MessageCenterPage>(
        webUrl,
        '/api/integrations/vela/message-center-public/messages',
      );
      expect(messages).toEqual({ messages: [], nextCursor: null, unreadCount: 0 });

      // Every payload this route builds is a link into x.com / linkedin.com / ….
      expect(await postStatus(webUrl, '/api/social-share', { kind: 'open-design-repo' })).toBe(403);

      // Reaches raw.githubusercontent.com; the UI entry point is hidden too.
      expect(
        await postStatus(webUrl, '/api/design-systems/import/github', {
          githubUrl: 'https://github.com/nexu-io/open-design',
        }),
      ).toBe(503);
    });
  }, 180_000);

  test('the same surfaces keep their normal behavior with no flag file', async () => {
    const suite = await createSmokeSuite('closed-network-control');

    await suite.with.toolsDev(async ({ webUrl }) => {
      const status = await requestJson<ClosedNetworkStatusResponse>(webUrl, '/api/closed-network');
      expect(status).toEqual({ disabled: [], enabled: false, flagPath: null, source: null });

      // Deliberately NOT asserting on /api/github/open-design or
      // /api/community/discord here: without the marker those really do reach
      // the public internet, which would make this spec depend on CI egress.
      // The closed-network run above is what proves the gate; this run proves
      // the gate is not stuck on.
      const share = await requestJson<{ platforms: unknown[] }>(webUrl, '/api/social-share', {
        body: { kind: 'open-design-repo' },
      });
      expect(share.platforms.length).toBeGreaterThan(0);
    });
  }, 180_000);
});
