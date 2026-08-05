// @vitest-environment jsdom
//
// Settings must open in closed-network mode. The About row added for the mode
// only renders when `appVersionInfo` is present, and no existing SettingsDialog
// test passes one — so the closed-network render path had no cover at all.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from '../../src/components/SettingsDialog';
import { __resetClosedNetworkForTests, setClosedNetwork } from '../../src/features/closedNetwork';
import { I18nProvider } from '../../src/i18n';
import type { AppConfig } from '../../src/types';

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return { ...actual, useAnalytics: () => ({ track: vi.fn() }) };
});

const originalFetch = globalThis.fetch;

const baseConfig: AppConfig = {
  mode: 'api',
  apiKey: 'sk-test',
  apiProtocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  agentId: null,
  skillId: null,
  designSystemId: null,
  composio: { apiKeyConfigured: true },
} as AppConfig;

const appVersionInfo = {
  version: '0.16.1',
  channel: 'stable',
  platform: 'darwin',
  arch: 'arm64',
} as never;

function renderSettings(section: string, locale: 'en' | 'ko' = 'en') {
  return render(
    <I18nProvider initial={locale}>
      <SettingsDialog
        initial={baseConfig}
        agents={[]}
        daemonLive
        appVersionInfo={appVersionInfo}
        initialSection={section as never}
        onPersist={vi.fn()}
        onPersistComposioKey={vi.fn()}
        onClose={vi.fn()}
        onRefreshAgents={vi.fn()}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  __resetClosedNetworkForTests();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('SettingsDialog with closed-network mode on', () => {
  for (const section of ['execution', 'about'] as const) {
    it(`renders the ${section} section without throwing`, () => {
      setClosedNetwork(true);
      expect(() => renderSettings(section)).not.toThrow();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  }

  it('renders the About network row in Korean', () => {
    setClosedNetwork(true);
    expect(() => renderSettings('about', 'ko')).not.toThrow();
  });

  it('still renders with the mode off', () => {
    setClosedNetwork(false);
    expect(() => renderSettings('execution')).not.toThrow();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
