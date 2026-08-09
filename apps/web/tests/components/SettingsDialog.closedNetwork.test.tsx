// @vitest-environment jsdom

// Settings must survive every shape the closed-network status can arrive in.
//
// The closed-network feature shipped with a coverage hole that this file fills:
// the existing Settings specs render with no provider at all, so the flag-ON
// branch of the About badge had zero coverage, and nothing pinned the fact that
// Settings is the ONLY consumer that renders the status object itself. Every
// other guard site goes through `useClosedNetworkCapability`, which returns a
// plain boolean and cannot throw — so a bad status can only ever take down this
// one screen, which is exactly the blast radius these specs exist to prevent.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AppVersionInfo } from '../../src/types';

const { analyticsTrackMock } = vi.hoisted(() => ({ analyticsTrackMock: vi.fn() }));

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({
    track: analyticsTrackMock,
    setConsent: () => undefined,
    setIdentity: () => undefined,
    setConfigureGlobals: () => undefined,
  }),
}));

import { SettingsDialog } from '../../src/components/SettingsDialog';
import { DEFAULT_CONFIG } from '../../src/state/config';

const appVersionInfo: AppVersionInfo = {
  arch: 'arm64',
  channel: 'stable',
  packaged: true,
  platform: 'darwin',
  version: '9.9.9',
};

function renderSettings(wrap: (node: ReactNode) => ReactNode = (node) => node) {
  return render(
    wrap(
      <SettingsDialog
        initial={DEFAULT_CONFIG}
        agents={[]}
        daemonLive={true}
        appVersionInfo={appVersionInfo}
        initialSection="about"
        onPersist={vi.fn()}
        onPersistComposioKey={vi.fn()}
        onClose={vi.fn()}
        onRefreshAgents={vi.fn()}
      />,
    ),
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('SettingsDialog closed-network badge', () => {
  it('renders About with no ClosedNetworkProvider above it', async () => {
    renderSettings();
    // The version rows are the proof the About section actually rendered rather
    // than being swallowed by an error boundary.
    await waitFor(() => expect(screen.getByText('9.9.9')).toBeTruthy());
    expect(screen.queryByTestId('settings-closed-network')).toBeNull();
  });

  it('shows the read-only badge with its source and path when the mode is on', async () => {
    const { ClosedNetworkProvider } = await import('../../src/runtime/closed-network');
    // The provider seeds itself synchronously from its localStorage cache, which
    // is how a real closed-network machine paints from its second launch on.
    // Using it here keeps the assertion off the async /api round-trip.
    window.localStorage.setItem(
      'open-design:closed-network',
      JSON.stringify({
        enabled: true,
        source: 'flag-file',
        flagPath: '/work/.open-design/closed-network.json',
        disabled: ['community-links', 'auto-update'],
      }),
    );

    renderSettings((node) => <ClosedNetworkProvider>{node}</ClosedNetworkProvider>);

    const badge = await screen.findByTestId('settings-closed-network');
    expect(badge.textContent).toContain('/work/.open-design/closed-network.json');
  });

  // The regression this file was written for. Settings dereferences the status
  // object (`closedNetwork?.enabled`) rather than only asking for a boolean, so
  // a context carrying `undefined` must degrade to "not closed" instead of
  // throwing and taking the whole screen down.
  it('survives a context that carries undefined instead of a status', async () => {
    const { ClosedNetworkProvider } = await import('../../src/runtime/closed-network');
    // A cache entry that normalizes to nothing is the closest reachable stand-in
    // for "the status arrived malformed": the provider must fall back to the off
    // state rather than handing Settings something it will dereference.
    window.localStorage.setItem('open-design:closed-network', 'null');

    renderSettings((node) => <ClosedNetworkProvider>{node}</ClosedNetworkProvider>);

    await waitFor(() => expect(screen.getByText('9.9.9')).toBeTruthy());
    expect(screen.queryByTestId('settings-closed-network')).toBeNull();
  });
});
