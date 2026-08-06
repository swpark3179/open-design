// @vitest-environment jsdom
//
// The message centre versus closed-network mode.
//
// The panel's only source is a feed hosted by Open Design Cloud — the same
// family as the What's New card the mode already blocks — and it polls on
// mount, every 60s, on tab focus and on open. On an intranet every one of
// those was a refused request, so a locked-down install spent its whole
// session turning a permanent refusal into the panel's error state.
//
// The gate is `resolved && !closed`, not the bare flag: the first pull fires on
// mount, and on a fresh profile the flag reads "open" until the daemon replies.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageCenter } from '../../src/components/MessageCenter';
import {
  __resetClosedNetworkForTests,
  setClosedNetwork,
} from '../../src/features/closedNetwork';
import { I18nProvider } from '../../src/i18n';
import type { MessageCenterMessage } from '../../src/message-center-client';

const MESSAGES_KEY = 'open-design.message-center.anonymous-messages.v1';
const READ_KEY = 'open-design.message-center.anonymous-read-ids.v1';

const cachedMessage: MessageCenterMessage = {
  id: 'cached',
  audienceType: 'global',
  typeName: 'Product update',
  title: 'Pulled before the machine was locked down',
  body: 'Still on disk, so it still renders.',
  ctaLabel: null,
  ctaUrl: null,
  publishedAt: '2026-07-16T12:00:00.000Z',
  readAt: null,
};

function renderMessageCenter() {
  return render(
    <I18nProvider initial="en">
      <MessageCenter />
    </I18nProvider>,
  );
}

/** Long enough for the mount effects to have fired if they were going to. */
async function letEffectsRun() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});

afterEach(() => {
  cleanup();
  __resetClosedNetworkForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MessageCenter in closed-network mode', () => {
  it('does not pull the hosted feed', async () => {
    setClosedNetwork(true);
    renderMessageCenter();

    await letEffectsRun();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not pull it before the daemon has resolved the mode', async () => {
    renderMessageCenter();

    await letEffectsRun();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('pulls once the daemon reports the mode is off', async () => {
    setClosedNetwork(false);
    renderMessageCenter();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  });

  // Opening the panel is its own pull trigger, and it is the one a user
  // actually reaches for after seeing the bell.
  it('does not pull when the panel is opened', async () => {
    setClosedNetwork(true);
    renderMessageCenter();
    await letEffectsRun();

    fireEvent.click(screen.getByTestId('message-center-trigger'));

    await waitFor(() => expect(screen.getByTestId('message-center-dialog')).toBeTruthy());
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Skipping the pull must not leave the panel spinning on its initial
  // `loading` state: on an intranet the answer is "no feed", permanently, and
  // an empty list says that honestly where a spinner does not.
  it('settles on the empty state instead of loading or an error', async () => {
    setClosedNetwork(true);
    renderMessageCenter();
    await letEffectsRun();

    fireEvent.click(screen.getByTestId('message-center-trigger'));
    const dialog = await screen.findByTestId('message-center-dialog');

    await waitFor(() => expect(dialog.textContent).toContain('No messages yet'));
    expect(dialog.textContent).not.toContain('Retry');
  });

  // Messages pulled before the machine was locked down are already on disk.
  // The mode stops new requests; it does not withdraw local content.
  it('still shows messages cached before lockdown, and marks them read locally', async () => {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify([cachedMessage]));
    localStorage.setItem(READ_KEY, JSON.stringify([]));
    setClosedNetwork(true);
    renderMessageCenter();

    fireEvent.click(await screen.findByTestId('message-center-trigger'));
    const dialog = await screen.findByTestId('message-center-dialog');
    await waitFor(() => expect(dialog.textContent).toContain(cachedMessage.title));

    fireEvent.click(screen.getByText(cachedMessage.title));

    // The read receipt lands in localStorage, and no request went out for it —
    // the account path would have pushed it at a proxy that now refuses.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[];
      expect(stored).toContain(cachedMessage.id);
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
