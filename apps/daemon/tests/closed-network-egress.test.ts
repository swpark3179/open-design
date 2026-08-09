import { describe, expect, it, vi } from 'vitest';

import {
  CLOSED_NETWORK_CAPABILITIES,
  closedNetworkStatusFromDocument,
  type ClosedNetworkCapability,
  type ClosedNetworkStatus,
} from '@open-design/contracts';

import { readPublicConfigResponse } from '../src/analytics.js';
import { createOpenDesignPublicMetadataService } from '../src/services/open-design-public-metadata.js';
import { createWhatsNewService } from '../src/services/whats-new.js';

// The point of these specs is narrow and load-bearing: in closed-network mode
// the daemon must not merely *fail* to reach api.github.com / discord.com /
// whatsnew.open-design.ai — it must not TRY. A blocked request still costs the
// caller a DNS or TLS timeout on every home activation, which is the symptom
// this mode exists to remove. So each one asserts on the injected `fetchImpl`
// never being called, not on the returned value alone.

function closedNetwork(allow: ClosedNetworkCapability[] = []): ClosedNetworkStatus {
  return closedNetworkStatusFromDocument(
    { closedNetwork: true, allow },
    { source: 'flag-file', flagPath: '/work/.open-design/closed-network.json' },
  );
}

function neverCalledFetch() {
  return vi.fn(async () => {
    throw new Error('closed-network mode must not reach the network');
  }) as unknown as typeof fetch;
}

describe('open-design public metadata in closed-network mode', () => {
  it('answers GitHub stars from an empty snapshot without fetching', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createOpenDesignPublicMetadataService({
      fetchImpl,
      closedNetwork: closedNetwork(),
    });

    await expect(service.readGithubRepoStats()).resolves.toEqual({
      stargazersCount: 0,
      fetchedAt: 0,
      stale: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers Discord presence from an empty snapshot without fetching', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createOpenDesignPublicMetadataService({
      fetchImpl,
      closedNetwork: closedNetwork(),
    });

    await expect(service.readDiscordPresence()).resolves.toEqual({
      onlineCount: 0,
      memberCount: 0,
      fetchedAt: 0,
      stale: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // No honest empty value exists for a release URL, so this one refuses. The
  // route turns that into the same error response an upstream failure produces.
  it('refuses the latest-release read without fetching', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createOpenDesignPublicMetadataService({
      fetchImpl,
      closedNetwork: closedNetwork(),
    });

    await expect(service.readLatestReleaseInfo()).rejects.toThrow(/closed-network/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still fetches when the marker allows home-external-content', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stargazers_count: 42 }),
    })) as unknown as typeof fetch;
    const service = createOpenDesignPublicMetadataService({
      fetchImpl,
      closedNetwork: closedNetwork(['home-external-content']),
    });

    await expect(service.readGithubRepoStats()).resolves.toMatchObject({
      stargazersCount: 42,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("what's new in closed-network mode", () => {
  it('resolves to no card without fetching, even on a release channel', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createWhatsNewService({
      fetchImpl,
      env: {} as NodeJS.ProcessEnv,
      closedNetwork: closedNetwork(),
    });

    await expect(service.readWhatsNew('stable')).resolves.toMatchObject({
      id: null,
      content: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // OD_WHATS_NEW_URL normally opts any channel in; closed-network still wins.
  it('ignores an explicit OD_WHATS_NEW_URL override', async () => {
    const fetchImpl = neverCalledFetch();
    const service = createWhatsNewService({
      fetchImpl,
      env: { OD_WHATS_NEW_URL: 'https://example.test/whats-new.json' } as NodeJS.ProcessEnv,
      closedNetwork: closedNetwork(),
    });

    await expect(service.readWhatsNew('development')).resolves.toMatchObject({ id: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('analytics config in closed-network mode', () => {
  const env = { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://posthog.test' } as NodeJS.ProcessEnv;

  // Withholding the key/host is what actually stops the BROWSER: posthog-js
  // never initializes and the consent-bypassing exception beacon has nowhere to
  // POST. There is no separate renderer-side switch to keep in sync.
  it('withholds the PostHog key and host from the renderer', () => {
    expect(readPublicConfigResponse(env, closedNetwork())).toMatchObject({
      enabled: false,
      key: null,
      host: null,
    });
  });

  it('still serves them when the marker allows telemetry', () => {
    expect(readPublicConfigResponse(env, closedNetwork(['telemetry']))).toMatchObject({
      enabled: true,
      key: 'phc_test',
      host: 'https://posthog.test',
    });
  });

  it('is unchanged when closed-network mode is off', () => {
    expect(readPublicConfigResponse(env, null)).toMatchObject({
      enabled: true,
      key: 'phc_test',
    });
  });
});

describe('capability coverage', () => {
  // A new capability added to the union without a guard behind it would ship as
  // a silently dead switch. This does not prove each one is wired, but it does
  // fail loudly the moment the list changes, which sends the author back here.
  it('disables every known capability when the marker names no exceptions', () => {
    expect(closedNetwork().disabled).toEqual([...CLOSED_NETWORK_CAPABILITIES]);
  });
});
