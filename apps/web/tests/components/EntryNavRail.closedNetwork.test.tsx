// @vitest-environment jsdom
//
// #5517 moved the SNS chrome off the entry topbar and into the rail's account
// menu — GitHub help, feature request, and the GitHub·Discord·X·mail row. That
// made this rail, not `EntrySettingsMenu`, the live surface closed-network mode
// has to clear. The account entries that keep working offline (Settings,
// Message center, Sign out) must survive: dropping them was the failure mode
// that made the product unusable on an intranet in the first place.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';
import {
  __resetClosedNetworkForTests,
  setClosedNetwork,
} from '../../src/features/closedNetwork';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({
    track: vi.fn(),
    newRequestId: vi.fn(() => 'request-nav-1'),
  }),
}));

const signedInContext = {
  workspaceId: 'ws-personal',
  workspaceType: 'personal',
  workspaceMemberId: 'wm-1',
  role: 'owner',
  memberStatus: 'active',
  lifecycleState: 'active',
  permissions: { canInviteMembers: false, canViewWorkspaceSettings: false },
} as unknown as WorkspaceCollabContext;

function renderRailWithAccountMenu(onOpenSettings = vi.fn()) {
  const view = render(
    <I18nProvider initial="en">
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        context={signedInContext}
        onOpenSettings={onOpenSettings}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('entry-nav-account'));
  return { ...view, onOpenSettings };
}

/**
 * Anchors on the invariant ("nothing in this menu leaves the machine") rather
 * than on a list of known destinations, so a newly added external link fails
 * this test instead of quietly slipping past it.
 */
function outboundHrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a[href]'))
    .map((anchor) => anchor.getAttribute('href') ?? '')
    .filter((href) => /^(https?:|mailto:)/i.test(href));
}

afterEach(() => {
  cleanup();
  __resetClosedNetworkForTests();
});

describe('EntryNavRail account menu in closed-network mode', () => {
  it('exposes no link that leaves the machine', () => {
    setClosedNetwork(true);
    const { container } = renderRailWithAccountMenu();

    expect(outboundHrefs(container)).toEqual([]);
  });

  it('keeps Settings, Message center and Sign out', () => {
    setClosedNetwork(true);
    const { onOpenSettings } = renderRailWithAccountMenu();

    expect(screen.getByTestId('account-menu-message-center')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('still renders the community links when the mode is off', () => {
    setClosedNetwork(false);
    const { container } = renderRailWithAccountMenu();

    const hrefs = outboundHrefs(container);
    expect(hrefs.some((href) => href.includes('discord.gg'))).toBe(true);
    expect(hrefs.some((href) => href.includes('x.com'))).toBe(true);
    expect(hrefs.some((href) => href.includes('github.com'))).toBe(true);
  });
});
