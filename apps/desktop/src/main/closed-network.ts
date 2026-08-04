/**
 * @module closed-network
 *
 * Desktop-shell read of closed-network (intranet) mode.
 *
 * The shell never resolves the mode itself: the packaged entry
 * (`apps/packaged/src/index.ts`) reads the `~/.open-design/closed-network`
 * marker file, `OD_CLOSED_NETWORK`, and the `--closed-network` flag before
 * anything else starts, then republishes the answer onto `process.env`. Keeping
 * the filesystem lookup out of here preserves the "pure input→value, no
 * filesystem access" property the updater config depends on.
 *
 * Accepts the same spellings as `apps/daemon/src/closed-network.ts` so a value
 * that enables the mode in the daemon can never be a silent no-op here. The
 * read is deliberately lenient: an unrecognised value degrades to "off" rather
 * than throwing, because these call sites (application menu, updater bootstrap)
 * must not be able to take down the desktop shell over a typo. The daemon
 * reports the bad value with a hard error of its own.
 */

export const CLOSED_NETWORK_ENV = "OD_CLOSED_NETWORK";

const CLOSED_NETWORK_TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isClosedNetworkEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CLOSED_NETWORK_ENV];
  return typeof raw === "string" && CLOSED_NETWORK_TRUTHY.has(raw.trim().toLowerCase());
}
