// Closed-network mode ("폐쇄망 모드") — the shared vocabulary between the daemon,
// the packaged/desktop shells, the web UI, and the `od` CLI.
//
// The mode exists for corporate intranets where the machine still has general
// internet access but specific hosts (github.com, api.github.com, *.github.io,
// social networks, …) are blocked at the perimeter. Every capability listed in
// `CLOSED_NETWORK_CAPABILITIES` either reaches one of those hosts or offers the
// user an action that cannot possibly succeed there, so the mode turns them off
// at the daemon boundary AND hides their entry points in the UI.
//
// This module is deliberately pure: it owns the *contract* (marker filename,
// document schema, capability names, precedence) while each app performs its
// own filesystem read. `packages/contracts` must not import `node:fs`.

/**
 * Marker file, relative to the top level of a configured project location
 * (Settings → Project locations). Mirrors the existing per-project
 * `.open-design/project.json` manifest convention one directory level up.
 */
export const CLOSED_NETWORK_FLAG_RELATIVE_PATH = '.open-design/closed-network.json';

/**
 * Escape hatch / override. Follows the `OD_SANDBOX_MODE` precedent: an explicit
 * env value always wins over whatever is (or is not) on disk, so an operator can
 * force the mode on for a headless or container deployment that has no project
 * location to drop a file into, and force it off to debug.
 */
export const CLOSED_NETWORK_ENV = 'OD_CLOSED_NETWORK';

/**
 * Capabilities the mode can switch off. A flag document may name a subset in
 * `allow` to keep one of them alive — organizations block different things, so
 * all-or-nothing would push sites that only block GitHub into disabling more
 * than they need.
 */
export const CLOSED_NETWORK_CAPABILITIES = [
  /** GitHub / Discord / X / Threads / YouTube / Instagram / LinkedIn / Xiaohongshu links, community counts. */
  'community-links',
  /** The social share grid and every `share to <platform>` intent URL. */
  'social-share',
  /** Publishing or deploying an artifact to a public host (public links, Vercel, Cloudflare, repo publish, PRs). */
  'external-publish',
  /** Home-surface content fetched from the internet: star counts, Discord presence, What's New, preview CDN. */
  'home-external-content',
  /** PostHog product analytics, session replay, and crash/exception reporting. */
  'telemetry',
  /** The packaged auto-updater feed poll and its automatic download. */
  'auto-update',
  /** Plugin marketplace refresh plus GitHub-sourced plugin / skill / design-system installs. */
  'plugin-marketplace',
  /** The AMR/Vela message center and its background poll. */
  'message-center',
] as const;

export type ClosedNetworkCapability = (typeof CLOSED_NETWORK_CAPABILITIES)[number];

/** Where the resolved decision came from. `null` when the mode is off. */
export type ClosedNetworkSource = 'env' | 'flag-file';

export interface ClosedNetworkStatus {
  enabled: boolean;
  source: ClosedNetworkSource | null;
  /**
   * Absolute path of the marker that turned the mode on, for the read-only
   * Settings → About badge. Null when the mode is off or came from the env var.
   */
  flagPath: string | null;
  /** Capabilities actually switched off — `CLOSED_NETWORK_CAPABILITIES` minus the document's `allow`. */
  disabled: ClosedNetworkCapability[];
}

/** The off state. Shared so every caller spells "not in closed-network mode" identically. */
export const CLOSED_NETWORK_DISABLED_STATUS: ClosedNetworkStatus = {
  enabled: false,
  source: null,
  flagPath: null,
  disabled: [],
};

/** Parsed shape of a `.open-design/closed-network.json` document. */
export interface ClosedNetworkFlagDocument {
  closedNetwork: boolean;
  allow: ClosedNetworkCapability[];
}

function isCapability(value: unknown): value is ClosedNetworkCapability {
  return (
    typeof value === 'string' &&
    (CLOSED_NETWORK_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * Parse an already-read marker document.
 *
 * Returns `null` for anything that is not a recognizable flag document. That is
 * the safety-critical direction of this function: a truncated, hand-edited, or
 * wrong-schema file must leave the app in its normal, fully-functional state
 * rather than silently locking a user out of features. Only an explicit
 * `closedNetwork: true` turns the mode on.
 *
 * Unknown entries in `allow` are dropped rather than rejected, so a file written
 * for a newer build still parses on an older one.
 */
export function parseClosedNetworkFlagDocument(raw: unknown): ClosedNetworkFlagDocument | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  if (doc.closedNetwork !== true) return null;
  const allow = Array.isArray(doc.allow) ? doc.allow.filter(isCapability) : [];
  return { closedNetwork: true, allow: Array.from(new Set(allow)) };
}

/** Build the status a flag document implies, given where it was found. */
export function closedNetworkStatusFromDocument(
  document: ClosedNetworkFlagDocument,
  init: { source: ClosedNetworkSource; flagPath: string | null },
): ClosedNetworkStatus {
  const allowed = new Set<ClosedNetworkCapability>(document.allow);
  return {
    enabled: true,
    source: init.source,
    flagPath: init.flagPath,
    disabled: CLOSED_NETWORK_CAPABILITIES.filter((capability) => !allowed.has(capability)),
  };
}

/**
 * The single predicate every guard site should call. Reads correctly for a
 * `null`/absent status too, so callers that have not finished loading the
 * daemon's answer keep the app's normal behavior instead of hiding UI on a
 * hunch.
 */
export function isClosedNetworkCapabilityDisabled(
  status: ClosedNetworkStatus | null | undefined,
  capability: ClosedNetworkCapability,
): boolean {
  if (!status?.enabled) return false;
  return status.disabled.includes(capability);
}

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_ENV_VALUES = new Set(['0', 'false', 'no', 'off', '']);

/**
 * Read the `OD_CLOSED_NETWORK` override.
 *
 * `undefined` means "unset — fall through to the flag file". Unlike
 * `isSandboxModeEnabled`, an unrecognized value does NOT throw: refusing to boot
 * the daemon over a typo'd network-policy hint would be a worse outcome than
 * ignoring the hint, and the flag file remains the documented mechanism.
 */
export function closedNetworkEnvOverride(
  env: Record<string, string | undefined>,
): boolean | undefined {
  const raw = env[CLOSED_NETWORK_ENV];
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (TRUTHY_ENV_VALUES.has(value)) return true;
  if (FALSY_ENV_VALUES.has(value)) return false;
  return undefined;
}
