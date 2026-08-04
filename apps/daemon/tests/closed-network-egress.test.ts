import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isClosedNetworkError } from '../src/closed-network.js';
import { createOpenDesignPublicMetadataService } from '../src/services/open-design-public-metadata.js';
import { createWhatsNewService, whatsNewSourceUrl } from '../src/services/whats-new.js';

// The claim this feature makes is "no socket is opened", not "the request
// fails". Every assertion below therefore checks that the injected fetch was
// never CALLED — an error response would also satisfy a status-code assertion
// while still having hit the network.

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function markerStateDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'od-closed-network-egress-'));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, 'closed-network'), '');
  return dir;
}

function neverCalledFetch() {
  return vi.fn<typeof fetch>(async () => {
    throw new Error('closed-network mode must not reach the network');
  });
}

describe('open-design public metadata in closed-network mode', () => {
  it('refuses GitHub repo stats without calling fetch', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createOpenDesignPublicMetadataService({ fetchImpl, closedNetwork: true });

    await expect(service.readGithubRepoStats()).rejects.toSatisfy(isClosedNetworkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses the latest-release lookup without calling fetch', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createOpenDesignPublicMetadataService({ fetchImpl, closedNetwork: true });

    await expect(service.readLatestReleaseInfo()).rejects.toSatisfy(isClosedNetworkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses Discord presence without calling fetch', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createOpenDesignPublicMetadataService({ fetchImpl, closedNetwork: true });

    await expect(service.readDiscordPresence()).rejects.toSatisfy(isClosedNetworkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still fetches normally when the mode is off', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ stargazers_count: 51_600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = createOpenDesignPublicMetadataService({ fetchImpl });

    await expect(service.readGithubRepoStats()).resolves.toMatchObject({
      stargazersCount: 51_600,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("what's new in closed-network mode", () => {
  it('resolves to no card without calling fetch, even on a release channel', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createWhatsNewService({ fetchImpl, closedNetwork: true });

    await expect(service.readWhatsNew('stable')).resolves.toMatchObject({
      id: null,
      content: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // A fixture override is an operator convenience, not an escape hatch: it must
  // not be able to reintroduce an outbound request on a locked-down machine.
  it('outranks the OD_WHATS_NEW_URL override', () => {
    const env = { OD_WHATS_NEW_URL: 'https://fixture.local/whats-new.json' };
    expect(whatsNewSourceUrl(env, 'stable', false)).toBe('https://fixture.local/whats-new.json');
    expect(whatsNewSourceUrl(env, 'stable', true)).toBeNull();
  });
});

describe('analytics config in closed-network mode', () => {
  it('reports no PostHog key or host even when the build baked one in', async () => {
    const { readPosthogConfig, readPublicConfigResponse } = await import('../src/analytics.js');
    const env = { POSTHOG_KEY: 'phc_test', OD_USER_STATE_DIR: markerStateDir() };

    expect(readPosthogConfig(env)).toBeNull();
    // `enabled: false` keeps posthog-js off; a null key also silences the
    // always-on renderer error tracker, which posts outside user consent.
    expect(readPublicConfigResponse(env)).toMatchObject({
      enabled: false,
      key: null,
      host: null,
    });
  });

  it('still reports the key when the mode is off', async () => {
    const { readPosthogConfig } = await import('../src/analytics.js');
    expect(readPosthogConfig({ POSTHOG_KEY: 'phc_test' })).toMatchObject({ key: 'phc_test' });
  });
});

describe('run telemetry sink in closed-network mode', () => {
  it('has no sink even with a relay URL or Langfuse credentials configured', async () => {
    const { readTelemetrySinkConfig } = await import('../src/langfuse-trace.js');
    const closed = { OD_USER_STATE_DIR: markerStateDir() };

    expect(
      readTelemetrySinkConfig({
        ...closed,
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
      }),
    ).toBeNull();
    expect(
      readTelemetrySinkConfig({
        ...closed,
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
      }),
    ).toBeNull();
  });

  it('still resolves a sink when the mode is off', async () => {
    const { readTelemetrySinkConfig } = await import('../src/langfuse-trace.js');
    expect(
      readTelemetrySinkConfig({
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
      }),
    ).toMatchObject({ kind: 'relay' });
  });
});
