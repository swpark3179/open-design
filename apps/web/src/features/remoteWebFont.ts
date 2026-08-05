// The renderer's one remote font, loaded at runtime instead of from CSS.
//
// This used to be the first line of `index.css`:
//
//   @import url('https://fonts.googleapis.com/css2?family=Cairo:...');
//
// A CSS `@import` is render-blocking and unconditional — it fired on every
// page load regardless of closed-network mode, because a stylesheet cannot
// read a runtime flag. On an intranet that *refuses* the connection that costs
// nothing visible, but a network that silently drops the packet leaves the
// import hanging until the connect timeout, stalling first paint on a request
// that was never going to succeed. It also plainly contradicted the mode's
// guarantee: no automatic request leaves the machine.
//
// Loading it from here instead makes it skippable. Cairo is only the first
// entry of the `--sans` stack in `styles/viewer/library.css`, ahead of Inter,
// Vazirmatn, Noto Sans Arabic and the system fonts, so a closed-network install
// simply renders in the next font down.

import { useEffect } from 'react';

import { useClosedNetwork, useClosedNetworkResolved } from './closedNetwork';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap';
const LINK_ID = 'od-remote-web-font';

/**
 * Attaches the remote font stylesheet on connected installs and keeps it off
 * closed-network ones. Mount once, at the app root.
 *
 * Waits for the daemon's actual answer instead of acting on the cached hint.
 * On a fresh profile the hint reads "not closed" until the status call lands,
 * which is long enough to let the font request escape a machine that turns out
 * to be locked down — and a sent request cannot be recalled. So nothing is
 * attached until we know, which costs a connected install a font swap shortly
 * after first paint and costs a closed one nothing at all.
 */
export function useRemoteWebFont(): void {
  const closedNetwork = useClosedNetwork();
  const resolved = useClosedNetworkResolved();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(LINK_ID);

    if (closedNetwork || !resolved) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, [closedNetwork, resolved]);
}
