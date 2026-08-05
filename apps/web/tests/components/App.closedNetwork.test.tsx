// @vitest-environment jsdom
//
// Regression cover for the closed-network flag being resolved behind the
// bootstrap effect's `daemonIsLive()` gate.
//
// The renderer paints its first frame from a localStorage hint and relies on
// GET /api/daemon/status to correct it. When that fetch lived inside the
// bootstrap effect it was skipped entirely on a boot where the health probe
// lost its race with the daemon — and because that effect's deps are stable
// callbacks it never re-ran, so the stale hint became the permanent answer.
// An install restarted with OD_CLOSED_NETWORK=0 stayed locked down forever.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
import type { AppConfig } from '../../src/types';
import { loadConfig, mergeDaemonConfig, fetchDaemonConfig } from '../../src/state/config';
import {
  daemonIsLive,
  fetchAgentsStream,
  fetchAppVersionInfo,
  fetchDaemonRuntimeFlags,
  fetchDesignSystems,
  fetchPromptTemplates,
  fetchSkills,
} from '../../src/providers/registry';
import { fetchAmrModels, fetchVelaLoginStatus } from '../../src/providers/daemon';
import { listProjects, listTemplates } from '../../src/state/projects';
import { __resetClosedNetworkForTests, isClosedNetwork } from '../../src/features/closedNetwork';

const STORAGE_KEY = 'open-design:closed-network';

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
  useRoute: () => ({ kind: 'home' as const, view: 'home' as const }),
}));

vi.mock('../../src/components/EntryView', () => ({
  EntryView: () => <div data-testid="entry-view" />,
}));

vi.mock('../../src/components/ProjectView', () => ({
  ProjectView: () => null,
}));

vi.mock('../../src/components/pet/PetOverlay', () => ({
  PetOverlay: () => null,
}));

vi.mock('../../src/components/pet/pets', () => ({
  migrateCustomPetAtlas: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/components/SettingsDialog', () => ({
  SettingsDialog: () => null,
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    daemonIsLive: vi.fn(),
    fetchAgentsStream: vi.fn(),
    fetchAppVersionInfo: vi.fn(),
    fetchDaemonRuntimeFlags: vi.fn(),
    fetchDesignSystems: vi.fn(),
    fetchPromptTemplates: vi.fn(),
    fetchSkills: vi.fn(),
  };
});

vi.mock('../../src/providers/daemon', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/daemon')>(
    '../../src/providers/daemon',
  );
  return { ...actual, fetchAmrModels: vi.fn(), fetchVelaLoginStatus: vi.fn() };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return { ...actual, listProjects: vi.fn(), listTemplates: vi.fn() };
});

vi.mock('../../src/state/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/config')>(
    '../../src/state/config',
  );
  return {
    ...actual,
    fetchComposioConfigFromDaemon: vi.fn().mockResolvedValue(null),
    loadConfig: vi.fn(),
    mergeDaemonConfig: vi.fn(),
    saveConfig: vi.fn(),
    fetchDaemonConfig: vi.fn().mockResolvedValue({}),
    fetchMediaProvidersFromDaemon: vi.fn().mockResolvedValue({ status: 'ok', providers: null }),
    syncComposioConfigToDaemon: vi.fn().mockResolvedValue(true),
    syncConfigToDaemon: vi.fn().mockResolvedValue(undefined),
    syncMediaProvidersToDaemon: vi.fn().mockResolvedValue(undefined),
  };
});

const mockedDaemonIsLive = vi.mocked(daemonIsLive);
const mockedFetchDaemonRuntimeFlags = vi.mocked(fetchDaemonRuntimeFlags);

const baseConfig: AppConfig = {
  mode: 'api',
  apiKey: '',
  apiProtocol: 'anthropic',
  apiVersion: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  apiProtocolConfigs: {},
  agentId: null,
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
  mediaProviders: {},
  composio: {},
  agentModels: {},
  agentCliEnv: {},
};

beforeEach(() => {
  vi.mocked(fetchAgentsStream).mockResolvedValue([]);
  vi.mocked(fetchSkills).mockResolvedValue([]);
  vi.mocked(fetchDesignSystems).mockResolvedValue([]);
  vi.mocked(fetchPromptTemplates).mockResolvedValue([]);
  vi.mocked(fetchAppVersionInfo).mockResolvedValue(null);
  vi.mocked(fetchAmrModels).mockResolvedValue(null);
  vi.mocked(fetchVelaLoginStatus).mockResolvedValue(null);
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(listTemplates).mockResolvedValue([]);
  vi.mocked(loadConfig).mockReturnValue({ ...baseConfig });
  vi.mocked(mergeDaemonConfig).mockImplementation((local) => local);
  vi.mocked(fetchDaemonConfig).mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  __resetClosedNetworkForTests();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('App closed-network resolution', () => {
  // The reported bug: OD_CLOSED_NETWORK=0 could not turn the mode back off.
  it('corrects a stale hint even when the daemon is not live at boot', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    mockedDaemonIsLive.mockResolvedValue(false);
    mockedFetchDaemonRuntimeFlags.mockResolvedValue({ closedNetwork: false });

    render(<App />);

    await waitFor(() => expect(mockedFetchDaemonRuntimeFlags).toHaveBeenCalled());
    await waitFor(() => expect(isClosedNetwork()).toBe(false));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('applies the daemon answer on a normal live boot', async () => {
    mockedDaemonIsLive.mockResolvedValue(true);
    mockedFetchDaemonRuntimeFlags.mockResolvedValue({ closedNetwork: true });

    render(<App />);

    await waitFor(() => expect(isClosedNetwork()).toBe(true));
  });

  // A fetch failure is not an answer. Clearing the hint here would flash the
  // SNS chrome back on for a machine that is genuinely locked down.
  it('keeps the cached hint when the daemon does not answer', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: true, ts: Date.now() }));
    mockedDaemonIsLive.mockResolvedValue(false);
    mockedFetchDaemonRuntimeFlags.mockResolvedValue(null);

    render(<App />);

    await waitFor(() => expect(mockedFetchDaemonRuntimeFlags).toHaveBeenCalled());
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});
