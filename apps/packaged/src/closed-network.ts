import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * @module closed-network
 *
 * Packaged-runtime twin of `apps/daemon/src/closed-network.ts`.
 *
 * The packaged main process has to know whether closed-network mode is on
 * *before* it spawns the daemon sidecar (which needs `OD_CLOSED_NETWORK` in its
 * env) and before it builds the desktop updater config (which must not poll
 * `releases.open-design.ai`). It cannot import the daemon's copy: app packages
 * must not import another app's private `src/` as a shared helper (root
 * AGENTS.md → Boundary constraints), and `packages/platform` must not hard-code
 * Open Design constants (packages/AGENTS.md). So the ~40 lines are duplicated
 * on purpose, the same way `AppConfigPrefs` is duplicated between the daemon
 * and `@open-design/contracts`.
 *
 * Keep the precedence table identical to the daemon's:
 *   marker file  >  OD_CLOSED_NETWORK  >  --closed-network
 * The marker file is authoritative and cannot be turned off by env or flag.
 *
 * `apps/packaged/tests/closed-network.test.ts` and
 * `apps/daemon/tests/closed-network.test.ts` assert the same table so the twins
 * cannot drift silently.
 */

export const CLOSED_NETWORK_ENV = "OD_CLOSED_NETWORK";
export const CLOSED_NETWORK_FLAG = "--closed-network";
export const CLOSED_NETWORK_MARKER_FILENAME = "closed-network";
export const USER_STATE_DIR_ENV = "OD_USER_STATE_DIR";

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSY_VALUES = new Set(["0", "false", "no", "off", ""]);

const HOME_BARE_TOKENS = new Set(["~", "$HOME", "${HOME}"]);
const HOME_PREFIX_RE = /^(~|\$\{HOME\}|\$HOME)[/\\](.*)$/;

function expandHomePrefix(raw: string, home: string): string {
  if (HOME_BARE_TOKENS.has(raw)) return home;
  const match = HOME_PREFIX_RE.exec(raw);
  if (match) return join(home, match[2] ?? "");
  return raw;
}

export type ClosedNetworkResolveOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Result of {@link parseClosedNetworkArgs}; can only turn the mode on. */
  flag?: boolean;
};

export function closedNetworkUserStateDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const raw = env[USER_STATE_DIR_ENV]?.trim();
  if (raw) {
    const expanded = expandHomePrefix(raw, home);
    return isAbsolute(expanded) ? resolve(expanded) : resolve(home, expanded);
  }
  return join(home, ".open-design");
}

export function closedNetworkMarkerPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return join(closedNetworkUserStateDir(env, home), CLOSED_NETWORK_MARKER_FILENAME);
}

export function hasClosedNetworkMarker(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): boolean {
  try {
    return existsSync(closedNetworkMarkerPath(env, home));
  } catch {
    return false;
  }
}

/**
 * Strict parse — an unrecognised value is a configuration error, not a silent
 * `false`. Returns null when unset so callers can fall through.
 */
export function parseClosedNetworkEnvValue(raw: string | undefined): boolean | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (TRUTHY_VALUES.has(value)) return true;
  if (FALSY_VALUES.has(value)) return false;
  throw new Error(
    `${CLOSED_NETWORK_ENV} must be one of ${Array.from(TRUTHY_VALUES).join(", ")} ` +
      `or ${Array.from(FALSY_VALUES).join(", ")}`,
  );
}

/**
 * Lenient read for never-throw paths such as crash reporting, where a typo in
 * the env must degrade to "off" rather than take down the reporter. Use
 * {@link resolveClosedNetwork} everywhere else — it surfaces bad values.
 */
export function isClosedNetworkEnvLoose(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CLOSED_NETWORK_ENV];
  return typeof raw === "string" && TRUTHY_VALUES.has(raw.trim().toLowerCase());
}

export function parseClosedNetworkArgs(argv: readonly string[]): boolean {
  return argv.includes(CLOSED_NETWORK_FLAG);
}

export function resolveClosedNetwork({
  env = process.env,
  home = homedir(),
  flag = false,
}: ClosedNetworkResolveOptions = {}): boolean {
  if (hasClosedNetworkMarker(env, home)) return true;
  if (parseClosedNetworkEnvValue(env[CLOSED_NETWORK_ENV]) === true) return true;
  return flag;
}
