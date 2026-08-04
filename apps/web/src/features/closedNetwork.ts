// Closed-network (intranet / air-gapped) mode for the renderer.
//
// Sibling of `libraryUi.ts`, which is this repo's home for "should this surface
// exist at all" flags — except this one is resolved at runtime rather than at
// build time. The daemon owns the answer (marker file / OD_CLOSED_NETWORK /
// --closed-network) and reports it on GET /api/daemon/status; `App.tsx` calls
// `setClosedNetwork` once during bootstrap.
//
// Two consumers, so this is a module store rather than a React context:
// components read it through `useClosedNetwork()`, and plain modules that have
// no hook context read `isClosedNetwork()`.
//
// The value is mirrored into localStorage and read back synchronously at module
// load so a machine already in closed-network mode paints the hidden state on
// the very first frame instead of flashing the SNS chrome for one round-trip.
// The mirror is an optimisation, never the authority: the daemon refuses the
// outbound requests regardless, so the worst case on a fresh profile is one
// frame of visible badges whose fetches are already being turned away.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'open-design:closed-network';

function readSeed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private-mode / blocked storage: fall back to "not closed", which the
    // bootstrap fetch corrects a moment later.
    return false;
  }
}

let closedNetwork = readSeed();
const listeners = new Set<() => void>();

function writeSeed(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Quota/permission errors only cost us the first-frame optimisation.
  }
}

/**
 * Apply the daemon's answer. Called once from the bootstrap fetch; safe to call
 * again (a repeat with the same value notifies nobody).
 */
export function setClosedNetwork(value: boolean): void {
  writeSeed(value);
  if (closedNetwork === value) return;
  closedNetwork = value;
  for (const listener of listeners) listener();
}

/** Non-React read, for modules that build URLs or decide whether to fetch. */
export function isClosedNetwork(): boolean {
  return closedNetwork;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return closedNetwork;
}

// Server snapshot: the web app also builds as a static export / SSR bundle, and
// neither can know the daemon's answer at render time. Always report "not
// closed" there so server and first client render agree; the store corrects
// itself from the localStorage seed on hydration.
function getServerSnapshot(): boolean {
  return false;
}

/**
 * True when this install must not show SNS, share, or external-link surfaces
 * and must not issue requests that leave the machine.
 */
export function useClosedNetwork(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test-only reset so suites do not leak state between cases. */
export function __resetClosedNetworkForTests(): void {
  closedNetwork = false;
  writeSeed(false);
  for (const listener of listeners) listener();
}
