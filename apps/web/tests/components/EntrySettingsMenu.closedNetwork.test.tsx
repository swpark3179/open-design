// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntrySettingsMenu } from '../../src/components/EntrySettingsMenu';
import {
  __resetClosedNetworkForTests,
  setClosedNetwork,
} from '../../src/features/closedNetwork';
import { I18nProvider } from '../../src/i18n';
import type { AppConfig } from '../../src/types';

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return { ...actual, useAnalytics: () => ({ track: vi.fn() }) };
});

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: 'daemon',
    agentId: null,
    agentModels: {},
    apiProtocol: 'anthropic',
    apiProtocolConfigs: {},
    apiKey: '',
    baseUrl: '',
    model: '',
    theme: 'system',
    ...overrides,
  } as AppConfig;
}

function renderMenu() {
  return render(
    <I18nProvider initial="en">
      <EntrySettingsMenu
        config={baseConfig()}
        onOpenSettings={vi.fn()}
      />
    </I18nProvider>,
  );
}

/**
 * Anchors on the invariant ("nothing in this popover leaves the machine")
 * rather than on a list of eight known SNS labels, so a newly added social
 * link fails this test instead of quietly slipping past it.
 */
function externalAnchorHrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a[href]'))
    .map((anchor) => anchor.getAttribute('href') ?? '')
    .filter((href) => /^(https?:)?\/\//i.test(href));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({}));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  __resetClosedNetworkForTests();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('EntrySettingsMenu in closed-network mode', () => {
  it('exposes no link that leaves the machine', () => {
    setClosedNetwork(true);
    const { container } = renderMenu();
    fireEvent.click(screen.getByTestId('entry-settings-menu-trigger'));

    expect(externalAnchorHrefs(container)).toEqual([]);
  });

  // The popover ships light-only since the theme row was folded into
  // Settings -> General, so what has to survive here is Language plus the row
  // that opens the full Settings dialog.
  it('keeps Language and the Settings row usable', () => {
    setClosedNetwork(true);
    const { container } = renderMenu();
    fireEvent.click(screen.getByTestId('entry-settings-menu-trigger'));

    expect(container.querySelector('.entry-settings-menu__select-trigger')).not.toBeNull();
    expect(screen.getByTestId('entry-settings-open-details')).not.toBeNull();
  });

  it('drops the social share grid', () => {
    setClosedNetwork(true);
    const { container } = renderMenu();
    fireEvent.click(screen.getByTestId('entry-settings-menu-trigger'));

    expect(container.querySelector('.social-share-grid')).toBeNull();
  });

  // Hiding the UI is not enough on its own: opening the popover must not ask
  // the daemon for Discord presence or a share payload it will never render.
  it('issues no presence or share-payload request when opened', () => {
    setClosedNetwork(true);
    renderMenu();
    fireEvent.click(screen.getByTestId('entry-settings-menu-trigger'));

    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested).not.toContain('/api/community/discord');
    expect(requested.filter((url) => url.includes('/api/social-share'))).toEqual([]);
  });

  it('still renders the community links when the mode is off', () => {
    setClosedNetwork(false);
    const { container } = renderMenu();
    fireEvent.click(screen.getByTestId('entry-settings-menu-trigger'));

    const hrefs = externalAnchorHrefs(container);
    expect(hrefs.some((href) => href.includes('discord.gg'))).toBe(true);
    expect(hrefs.some((href) => href.includes('x.com'))).toBe(true);
    expect(container.querySelector('.social-share-grid')).not.toBeNull();
  });
});
