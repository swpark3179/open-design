// Closed-network (intranet / air-gapped) mode for the renderer.
//
// Sibling of `libraryUi.ts`, which is this repo's home for "should this surface
// exist at all" flags — except this one is resolved at runtime rather than at
// build time. The daemon owns the answer (marker file / OD_CLOSED_NETWORK /
// --closed-network) and reports it on GET /api/daemon/status; `App.tsx`
// re-asserts it through `setClosedNetwork` on every boot and again whenever the
// daemon's liveness changes, so a daemon that binds after the web server still
// gets to correct the cached hint below.
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

/**
 * How long a cached hint may speak for the daemon.
 *
 * The hint exists only to avoid one frame of SNS chrome on a machine that is
 * already locked down, so an expired hint costs a single frame. An unbounded
 * one costs far more: if the status endpoint is never reachable, a `true`
 * written months ago would keep hiding features with nothing left to correct
 * it. Expiry keeps this an optimisation instead of a second source of truth.
 */
const SEED_TTL_MS = 24 * 60 * 60 * 1000;

function readSeed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return false;
    // Pre-TTL installs wrote a bare '1'. Honour it once so an existing
    // closed-network machine is not stranded by the format change; the
    // bootstrap fetch rewrites it in the stamped form.
    if (raw === '1') return true;
    const parsed = JSON.parse(raw) as { v?: unknown; ts?: unknown };
    if (parsed?.v !== true || typeof parsed.ts !== 'number') return false;
    return Date.now() - parsed.ts < SEED_TTL_MS;
  } catch {
    // Private-mode / blocked storage, or a malformed value: fall back to "not
    // closed", which the bootstrap fetch corrects a moment later.
    return false;
  }
}

let closedNetwork = readSeed();
const listeners = new Set<() => void>();

function writeSeed(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: true, ts: Date.now() }));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Quota/permission errors only cost us the first-frame optimisation.
  }
}

/**
 * Apply the daemon's answer, refreshing the cached hint's expiry. Called
 * whenever the daemon reports its status; safe to call again (a repeat with the
 * same value notifies nobody).
 *
 * Only call this with an answer the daemon actually gave. Passing `false`
 * because a fetch failed would clear a legitimate hint.
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
