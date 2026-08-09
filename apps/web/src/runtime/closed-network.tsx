'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ClosedNetworkCapability, ClosedNetworkStatus } from '@open-design/contracts';

/**
 * Closed-network mode ("폐쇄망 모드") for the renderer.
 *
 * The daemon owns the decision — it reads the marker file at startup and serves
 * it from `GET /api/closed-network`. This module is the one place the browser
 * asks, and `useClosedNetworkCapability` is the one predicate guard sites call.
 *
 * Two deliberate choices about the pre-answer window:
 *
 *  - The default is "not closed", so an ordinary install renders exactly as it
 *    did before this feature existed: no flash, no deferred chrome, no new
 *    dependency between the daemon answering and the first paint.
 *  - The last answer is cached in `localStorage` and used as the initial state,
 *    so a machine that IS in closed-network mode is correct from the first
 *    paint of its second launch onward. Only the very first launch after an
 *    operator drops the marker can briefly show a hidden surface.
 *
 * Caching the answer is safe because it only ever gates UI: the daemon refuses
 * the underlying calls regardless of what the renderer believes.
 */

const CLOSED_NETWORK_ENDPOINT = '/api/closed-network';
const CACHE_KEY = 'open-design:closed-network';

/**
 * The off state, and the capability predicate, defined locally on purpose.
 *
 * Types still come from `@open-design/contracts`, so renaming a capability or
 * changing the status shape breaks typecheck — the contract is intact. What is
 * deliberately NOT imported is the runtime *value*: this module is mounted in
 * the root layout and consumed by Settings, so a resolution failure against the
 * contracts bundle would take down the app shell rather than degrade one badge.
 * The repo already applies this reasoning in `apps/desktop/src/main/closed-network.ts`
 * and `apps/packaged/src/startup-telemetry.ts`, both of which replicate a
 * constant instead of taking on a cross-package runtime dependency.
 */
const DISABLED_STATUS: ClosedNetworkStatus = {
  enabled: false,
  source: null,
  flagPath: null,
  disabled: [],
};

function capabilityDisabled(
  status: ClosedNetworkStatus | null | undefined,
  capability: ClosedNetworkCapability,
): boolean {
  return status?.enabled === true && status.disabled.includes(capability);
}

function readCachedStatus(): ClosedNetworkStatus | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return normalizeStatus(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedStatus(status: ClosedNetworkStatus): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(status));
  } catch {
    // A full or blocked storage quota must not turn a chrome decision into a
    // render error; the in-memory value still covers this session.
  }
}

/**
 * Accept only a well-formed status. Anything else resolves to "not closed" so a
 * hand-edited cache entry or a future daemon shape cannot hide working UI.
 */
function normalizeStatus(value: unknown): ClosedNetworkStatus | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.enabled !== 'boolean') return null;
  if (!raw.enabled) return DISABLED_STATUS;
  const disabled = Array.isArray(raw.disabled)
    ? raw.disabled.filter((entry): entry is ClosedNetworkCapability => typeof entry === 'string')
    : [];
  return {
    enabled: true,
    source: raw.source === 'env' || raw.source === 'flag-file' ? raw.source : null,
    flagPath: typeof raw.flagPath === 'string' ? raw.flagPath : null,
    disabled,
  };
}

let inflight: Promise<ClosedNetworkStatus | null> | null = null;

/**
 * Single-flight read of the daemon's answer, shared across every caller in the
 * tab. Mirrors `loadRuntimeAppVersion` in `analytics/provider.tsx`.
 */
export function loadClosedNetworkStatus(): Promise<ClosedNetworkStatus | null> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch(CLOSED_NETWORK_ENDPOINT);
        if (!res.ok) return null;
        return normalizeStatus(await res.json());
      } catch {
        return null;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

const ClosedNetworkContext = createContext<ClosedNetworkStatus>(DISABLED_STATUS);

export function ClosedNetworkProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ClosedNetworkStatus>(
    () => readCachedStatus() ?? DISABLED_STATUS,
  );

  useEffect(() => {
    let cancelled = false;
    void loadClosedNetworkStatus().then((next) => {
      // A failed read keeps whatever we already had. Dropping to "not closed"
      // on a transient daemon hiccup would un-hide the very surfaces this mode
      // exists to hide.
      if (cancelled || !next) return;
      setStatus(next);
      writeCachedStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ClosedNetworkContext.Provider value={status}>{children}</ClosedNetworkContext.Provider>
  );
}

/** The full status. Use this for the read-only Settings badge; prefer the capability hook for guards. */
export function useClosedNetworkStatus(): ClosedNetworkStatus {
  // Never hand back a bare context read. A consumer that dereferences the
  // status directly (the Settings badge does) must not be able to throw because
  // something upstream produced an undefined value — mirrors `useI18n()`'s
  // `?? FALLBACK_I18N` in `src/i18n/index.tsx`.
  return useContext(ClosedNetworkContext) ?? DISABLED_STATUS;
}

/**
 * The guard every hidden surface uses:
 *
 *     const hideSocial = useClosedNetworkCapability('community-links');
 *     if (hideSocial) return null;
 */
export function useClosedNetworkCapability(capability: ClosedNetworkCapability): boolean {
  const status = useContext(ClosedNetworkContext);
  return useMemo(() => capabilityDisabled(status, capability), [status, capability]);
}
