// Closed-network mode at the real UI boundary.
//
// Two things the component tests cannot see:
//   1. The renderer must re-ask the daemon on every boot. A cached hint from an
//      earlier closed-network run once became the permanent answer, so an
//      install restarted with OD_CLOSED_NETWORK=0 stayed locked down.
//   2. Settings must stay reachable when the mode is on. #5517 made Home an
//      authenticated surface that redirects a signed-out user to the Open
//      Design Cloud sign-in screen — a screen whose only control is an outbound
//      OAuth round-trip. On an intranet that redirect took the nav rail, and
//      with it Settings, away for good.
//
// The suite's daemon is a normal (non-closed) runtime, so case 2 forces the
// mode on by intercepting the status endpoint rather than booting a second
// runtime — the renderer reads exactly one field from that response.

import { expect, test } from '@/playwright/suite';
import { routeAgents } from '@/playwright/mock-factory';
import { openSettingsDialog, settingsSurface } from '@/playwright/amr';
import type { Page } from '@playwright/test';

const CONFIG_KEY = 'open-design:config';
const CLOSED_NETWORK_KEY = 'open-design:closed-network';

test.describe.configure({ timeout: 60_000 });

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
// closed hint, and the hint must lose. Before the fix the corrective fetch sat
// behind the bootstrap effect's daemonIsLive() gate and never re-ran, so the
// hint became the permanent answer. Asserting on the stored hint rather than on
// a badge keeps this pinned to the store's contract — #5517 moved every SNS
// surface behind the signed-in account menu, which this fixture never opens.
test('[P1] a stale closed-network hint is corrected by the daemon on boot', async ({ page }) => {
  await seedClosedNetworkHint(page);
  await gotoEntryHome(page);

  // The hint must be cleared, not merely overridden in memory, or the next boot
  // starts from the same wrong state.
  await expect
    .poll(
      async () => page.evaluate((key) => window.localStorage.getItem(key), CLOSED_NETWORK_KEY),
      { timeout: 20_000 },
    )
    .toBeNull();
});

test.describe('with the daemon reporting closed-network mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/daemon/status', async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      await route.fulfill({ json: { ...body, closedNetwork: true } });
    });
  });

  test('[P1] settings stays reachable while the cloud gate is skipped', async ({ page }) => {
    await gotoEntryHome(page);

    // The mode is genuinely on...
    await expect
      .poll(
        async () => page.evaluate((key) => window.localStorage.getItem(key), CLOSED_NETWORK_KEY),
        { timeout: 20_000 },
      )
      .not.toBeNull();

    // ...the signed-out user was not pushed onto the sign-in screen they could
    // never clear...
    await expect(page.locator('.onboarding-view--cloud')).toHaveCount(0);

    // ...and Settings still opens from the rail.
    await openSettingsDialog(page);
    await expect(settingsSurface(page)).toBeVisible();
  });

  // The account menu is where #5517 parked the GitHub / Discord / X links and
  // the GitHub-issue rows. Nothing in the entry surface may leave the machine.
  test('[P2] the entry surface exposes no outbound link', async ({ page }) => {
    await gotoEntryHome(page);
    await expect
      .poll(
        async () => page.evaluate((key) => window.localStorage.getItem(key), CLOSED_NETWORK_KEY),
        { timeout: 20_000 },
      )
      .not.toBeNull();

    const outbound = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((anchor) => anchor.getAttribute('href') ?? '')
        .filter((href) => /^(https?:|mailto:)/i.test(href)),
    );
    expect(outbound).toEqual([]);
  });
});
