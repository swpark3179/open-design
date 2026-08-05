// Closed-network mode at the real UI boundary.
//
// Two things the component tests cannot see:
//   1. The renderer must re-ask the daemon on every boot. A cached hint from an
//      earlier closed-network run once became the permanent answer, so an
//      install restarted with OD_CLOSED_NETWORK=0 stayed locked down.
//   2. Settings must stay reachable when the mode is on. Hiding the SNS chrome
//      must never take the gear or the Settings dialog with it.
//
// The suite's daemon is a normal (non-closed) runtime, so case 2 forces the
// mode on by intercepting the status endpoint rather than booting a second
// runtime — the renderer reads exactly one field from that response.

import { expect, test } from '@/playwright/suite';
import { routeAgents } from '@/playwright/mock-factory';
import type { Page } from '@playwright/test';

const CONFIG_KEY = 'open-design:config';
const CLOSED_NETWORK_KEY = 'open-design:closed-network';
const OPEN_SETTINGS_LABEL = /Open settings|打开设置|開啟設定/i;

test.describe.configure({ timeout: 30_000 });

async function waitForLoadingToClear(page: Page) {
  await expect(page.getByText('Loading Open Design…')).toHaveCount(0, { timeout: 15_000 });
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve Open Design' });
  if (await privacyDialog.isVisible().catch(() => false)) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
  }
}

/** Seed the renderer as if a previous run had left the machine in closed-network mode. */
async function seedClosedNetworkHint(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({ v: true, ts: Date.now() }));
  }, CLOSED_NETWORK_KEY);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'codex',
        skillId: null,
        designSystemId: null,
        onboardingCompleted: true,
        agentModels: { codex: { model: 'default', reasoning: 'default' } },
        privacyDecisionAt: 1,
        telemetry: { metrics: false, content: false, artifactManifest: false },
      }),
    );
  }, CONFIG_KEY);

  await page.route('**/api/github/open-design', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stargazers_count: 51600 }),
    });
  });

  await routeAgents(page, [
    {
      id: 'codex',
      name: 'Codex CLI',
      bin: 'codex',
      available: true,
      version: '0.80.0',
      path: '/usr/local/bin/codex',
      models: [{ id: 'default', label: 'Default' }],
    },
  ]);
});

// The reported bug, end to end: the daemon is open, the renderer is holding a
// closed hint, and the UI must come back. Before the fix the corrective fetch
// sat behind the bootstrap effect's daemonIsLive() gate and the hint won.
test('[P1] a stale closed-network hint is corrected by the daemon on boot', async ({ page }) => {
  await seedClosedNetworkHint(page);
  await gotoEntryHome(page);

  await expect(page.getByTestId('entry-star-badge')).toBeVisible();
  await expect(page.getByTestId('entry-discord-badge')).toBeVisible();

  // The hint itself must be cleared, not merely overridden in memory, or the
  // next boot starts from the same wrong state.
  const hint = await page.evaluate((key) => window.localStorage.getItem(key), CLOSED_NETWORK_KEY);
  expect(hint).toBeNull();
});

test.describe('with the daemon reporting closed-network mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/daemon/status', async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      await route.fulfill({ json: { ...body, closedNetwork: true } });
    });
  });

  test('[P1] settings stays reachable while the SNS chrome is hidden', async ({ page }) => {
    await gotoEntryHome(page);

    // The mode is genuinely on...
    await expect(page.getByTestId('entry-star-badge')).toHaveCount(0);
    await expect(page.getByTestId('entry-discord-badge')).toHaveCount(0);

    // ...and settings is still fully reachable through the gear.
    await expect(page.getByRole('button', { name: OPEN_SETTINGS_LABEL })).toBeVisible();
    await page.getByTestId('entry-settings-menu-trigger').click();
    await page.getByTestId('entry-settings-open-details').click();

    const settingsDialog = page.getByRole('dialog');
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByRole('heading', { name: 'Execution mode' })).toBeVisible();
  });
});
