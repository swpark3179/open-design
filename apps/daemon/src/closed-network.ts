import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expandHomePrefix } from './home-expansion.js';

/**
 * @module closed-network
 *
 * Deployment switch for intranet / air-gapped installs. When enabled, the
 * daemon makes no automatic outbound request (GitHub repo stats, Discord
 * presence, What's New feed, PostHog, Langfuse, install attribution) and the
 * web UI hides every SNS, share, and external-link surface.
 *
 * The mode is administrator-owned, not a user preference: it is deliberately
 * absent from `AppConfigPrefs`/`ALLOWED_KEYS` in `app-config.ts`, so no client
 * `PUT /api/app-config` can turn it off.
 *
 * Resolution, highest precedence first:
 *
 *   1. Marker file at `<OD_USER_STATE_DIR | ~/.open-design>/closed-network`.
 *      Presence enables the mode; the file's content is ignored. This is the
 *      admin-deployment path and is authoritative — `OD_CLOSED_NETWORK=0`
 *      does NOT defeat it. A per-user env var must not be able to unlock a
 *      machine an administrator locked down.
 *   2. `OD_CLOSED_NETWORK` env var. Strict parse; it can only turn the mode ON.
 *   3. The `--closed-network` launch flag, which works by setting (2) before
 *      the server module is imported, so there is still exactly one
 *      resolution point per process.
 *
 * The user-state dir is `~/.open-design`, matching `deployConfigPath` in
 * `deploy.ts` and the local agent-profiles file in `runtimes/local-profiles.ts`.
 * It is deliberately NOT the daemon data dir: `OD_DATA_DIR` is project-local in
 * development and namespace-scoped when packaged, so only a home-level marker
 * applies to every launch. This module therefore does not participate in the
 * "Daemon data directory contract" in the root AGENTS.md.
 *
 * `apps/packaged/src/closed-network.ts` is a deliberate twin of this file: the
 * packaged main process must resolve the same answer before it spawns the
 * daemon sidecar and configures the updater, and app packages must not import
 * another app's private `src/` as a shared helper. Keep the two in sync; both
 * are covered by tests that assert the same precedence table.
 */

export const CLOSED_NETWORK_ENV = 'OD_CLOSED_NETWORK';
export const CLOSED_NETWORK_MARKER_FILENAME = 'closed-network';
export const USER_STATE_DIR_ENV = 'OD_USER_STATE_DIR';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', '']);

/**
 * User-level Open Design state root. Mirrors `deployConfigPath` in deploy.ts —
 * `OD_USER_STATE_DIR` when set, `~/.open-design` otherwise.
 */
export function closedNetworkUserStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env[USER_STATE_DIR_ENV]?.trim();
  if (raw) return path.resolve(expandHomePrefix(raw));
  return path.join(os.homedir(), '.open-design');
}

export function closedNetworkMarkerPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return path.join(closedNetworkUserStateDir(env), CLOSED_NETWORK_MARKER_FILENAME);
}

/**
 * True when the administrator dropped the marker file. Any filesystem error
 * other than "not there" is also treated as absent: an unreadable home
 * directory must not stop the daemon from booting.
 */
export function hasClosedNetworkMarker(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    return fs.existsSync(closedNetworkMarkerPath(env));
  } catch {
    return false;
  }
}

/**
 * Strict env parse, matching `isSandboxModeEnabled` in sandbox-mode.ts: an
 * unrecognised value is a configuration error, not a silent `false`.
 * Returns null when the variable is unset so callers can fall through.
 */
export function parseClosedNetworkEnvValue(raw: string | undefined): boolean | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (TRUTHY_VALUES.has(value)) return true;
  if (FALSY_VALUES.has(value)) return false;
  throw new Error(
    `${CLOSED_NETWORK_ENV} must be one of ${Array.from(TRUTHY_VALUES).join(', ')} ` +
      `or ${Array.from(FALSY_VALUES).join(', ')}`,
  );
}

export function isClosedNetworkEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (hasClosedNetworkMarker(env)) return true;
  return parseClosedNetworkEnvValue(env[CLOSED_NETWORK_ENV]) === true;
}

export const CLOSED_NETWORK_ERROR_CODE = 'closed-network';

/**
 * Thrown instead of opening a socket. Route handlers translate this into
 * `503 { error: 'closed-network' }` so the caller learns the request was
 * refused by policy rather than by an upstream outage.
 */
export class ClosedNetworkError extends Error {
  readonly code = CLOSED_NETWORK_ERROR_CODE;

  constructor(what: string) {
    super(`${what} is unavailable in closed-network mode (${CLOSED_NETWORK_ENV})`);
    this.name = 'ClosedNetworkError';
  }
}

export function isClosedNetworkError(error: unknown): error is ClosedNetworkError {
  return error instanceof ClosedNetworkError;
}

/**
 * Guard for outbound call sites: throws when the mode is on, otherwise returns.
 * Call this before constructing a request, never after.
 */
export function assertOutboundAllowed(closedNetwork: boolean, what: string): void {
  if (closedNetwork) throw new ClosedNetworkError(what);
}
