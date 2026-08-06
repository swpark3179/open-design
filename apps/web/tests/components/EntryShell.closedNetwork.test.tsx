// @vitest-environment jsdom
//
// The entry shell's Cloud identity gate versus closed-network mode.
//
// #5517 made Home an authenticated surface: a definitive signed-out result
// redirects to the Open Design Cloud sign-in screen. That screen's only control
// is an outbound OAuth round-trip, so on an intranet a signed-out user was
// parked on a dead button — and because the redirect replaces Home, the nav
// rail went with it and Settings became unreachable. These specs pin the
// escape: stay on Home when the mode is on, and open the wizard past the gate.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import {
  __resetClosedNetworkForTests,
  setClosedNetwork,
} from '../../src/features/closedNetwork';
import { I18nProvider } from '../../src/i18n';
import type { AgentInfo, AppConfig } from '../../src/types';

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      newRequestId: vi.fn(() => 'request-1'),
      setConfigureGlobals: vi.fn(),
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
      track: vi.fn(),
    }),
    useAppVersion: () => null,
  };
});

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function cliAgent(): AgentInfo {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    bin: 'claude',
    available: true,
    version: '1.0.0',
    models: [{ id: 'sonnet', label: 'Sonnet' }],
  };
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: 'daemon',
    agentId: 'claude-code',
    agentModels: { 'claude-code': { model: 'sonnet' } },
    apiProtocol: 'anthropic',
    apiProtocolConfigs: {},
    apiKey: '',
    baseUrl: '',
    model: '',
    onboardingCompleted: true,
    ...overrides,
  } as AppConfig;
}

function renderShell(
  overrides: Partial<React.ComponentProps<typeof EntryShell>> = {},
  path = '/',
) {
  window.history.replaceState(null, '', path);
  const props: React.ComponentProps<typeof EntryShell> = {
    skills: [],
    designTemplates: [],
    designSystems: [],
    projects: [],
    templates: [],
    promptTemplates: [],
    defaultDesignSystemId: null,
    connectors: [],
    connectorsLoading: false,
    config: baseConfig(),
    agents: [cliAgent()],
    daemonLive: true,
    // The signed-out result the identity gate keys on.
    amrLoggedIn: false,
    onModeChange: vi.fn(),
    onAgentChange: vi.fn(),
    onAgentModelChange: vi.fn(),
    onApiProtocolChange: vi.fn(),
    onApiModelChange: vi.fn(),
    onConfigPersist: vi.fn(),
    onRefreshAgents: vi.fn(() => [cliAgent()]),
    onCreateProject: vi.fn(),
    onCreatePluginShareProject: vi.fn(),
    onImportClaudeDesign: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenLiveArtifact: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    onChangeDefaultDesignSystem: vi.fn(),
    onPersistComposioKey: vi.fn(),
    onOpenSettings: vi.fn(),
    onCompleteOnboarding: vi.fn(),
    ...overrides,
  };

  render(
    <I18nProvider initial="en">
      <EntryShell {...props} />
    </I18nProvider>,
  );

  return props;
}

function cloudGateVisible(): boolean {
  return document.querySelectorAll('.onboarding-view--cloud').length > 0;
}

beforeEach(() => {
  globalThis.fetch = vi.fn(
    async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  __resetClosedNetworkForTests();
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = originalResizeObserver;
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('EntryShell cloud identity gate in closed-network mode', () => {
  it('keeps a signed-out user on Home instead of the unreachable sign-in screen', async () => {
    setClosedNetwork(true);
    renderShell();

    await waitFor(() => {
      expect(screen.getByTestId('entry-settings-button')).toBeTruthy();
    });
    expect(cloudGateVisible()).toBe(false);
  });

  // The counterweight, and the reason the redirect waits for the daemon's real
  // answer rather than the cached hint: on a connected install the gate must
  // still claim a signed-out user.
  it('still redirects a signed-out user when the mode is off', async () => {
    setClosedNetwork(false);
    renderShell();

    await waitFor(() => {
      expect(cloudGateVisible()).toBe(true);
    });
  });

  // Unresolved is not "off". Both signals land when the daemon comes live, and
  // the sign-out result routinely lands first — redirecting on that alone is
  // what stranded closed-network installs, and a later correction cannot
  // navigate back without fighting the user's history.
  //
  // "Has not answered" has to mean a daemon that genuinely did not reply: the
  // shell asks for the mode itself when nobody has resolved it, so a reachable
  // daemon always ends the hold. A 200 whose body simply omits the field is an
  // answer — from a build that predates the flag, and therefore cannot be
  // enforcing the mode.
  it('holds the redirect until the daemon has answered', async () => {
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/daemon/status')) return new Response(null, { status: 503 });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    renderShell();

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(cloudGateVisible()).toBe(false);
  });

  // The counterweight to the hold: an unresolved shell must resolve itself.
  // The gate lives in EntryShell but the authoritative read lives in AppInner,
  // so a shell mounted without it — or booted where its fetch lost — held a
  // redirect that nothing was ever going to release, silently dropping the
  // #5517 gate on an ordinary connected install.
  it('asks the daemon itself when nothing else has resolved the mode', async () => {
    renderShell();

    await waitFor(() => {
      expect(cloudGateVisible()).toBe(true);
    });
  });

  // A daemon built before the flag answers without the field. That is still an
  // answer, and it can only mean the mode is off — treating it as silence left
  // a version-skewed pair permanently unresolved.
  it('treats a status payload without the field as the mode being off', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, version: '0.0.0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    renderShell();

    await waitFor(() => {
      expect(cloudGateVisible()).toBe(true);
    });
  });
});

describe('OnboardingView in closed-network mode', () => {
  it('opens past the cloud identity gate on the model-source step', async () => {
    setClosedNetwork(true);
    renderShell({ config: baseConfig({ onboardingCompleted: false }) }, '/onboarding');

    await waitFor(() => {
      expect(screen.getByText('Choose your model source')).toBeTruthy();
    });
  });

  // Hosted is that same cloud sign-in wearing a different hat, so a signed-out
  // closed-network install must not be offered it — least of all as the
  // recommended default it would otherwise start on.
  it('does not offer Hosted to a signed-out install', async () => {
    setClosedNetwork(true);
    renderShell({ config: baseConfig({ onboardingCompleted: false }) }, '/onboarding');

    await waitFor(() => {
      expect(screen.getByText('Choose your model source')).toBeTruthy();
    });
    const labels = screen.getAllByRole('radio').map((option) => option.textContent ?? '');
    expect(labels.some((label) => label.includes('Open Design Hosted'))).toBe(false);
    expect(labels.some((label) => label.includes('Local Agent'))).toBe(true);
    // ...and the selection lands on something that is actually rendered, so
    // Continue cannot commit a runtime the user was never shown.
    const checked = screen
      .getAllByRole('radio')
      .filter((option) => option.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent ?? '').toContain('Local Agent');
  });

  it('still starts on the identity gate when the mode is off', async () => {
    setClosedNetwork(false);
    renderShell({ config: baseConfig({ onboardingCompleted: false }) }, '/onboarding');

    await waitFor(() => {
      expect(cloudGateVisible()).toBe(true);
    });
  });
});
