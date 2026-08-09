/**
 * @module closed-network
 *
 * Whether the packaged shell resolved closed-network mode ("폐쇄망 모드") for
 * this launch.
 *
 * The desktop main process never reads the marker file itself — `apps/packaged`
 * owns that resolution and stamps the answer into this process's environment
 * before the window exists (see `apps/packaged/src/closed-network.ts`). Main
 * only needs the boolean, for the two surfaces it owns: the auto-updater's feed
 * poll and the native Help menu's outbound links.
 *
 * The env name mirrors `CLOSED_NETWORK_ENV` in
 * `packages/contracts/src/api/closed-network.ts`. It is replicated rather than
 * imported for the same reason `apps/packaged/src/startup-telemetry.ts`
 * replicates its schema version: a single string is not worth pulling a new
 * cross-package dependency into the Electron main bundle.
 */

/**
 * Deliberately never throws. A typo in a network-policy hint must not take the
 * main process down — unlike the updater's own `isTruthyEnv`, which throws so a
 * malformed release-channel switch is caught loudly in CI.
 */
export function isClosedNetworkEnv(env: NodeJS.ProcessEnv): boolean {
  const raw = env.OD_CLOSED_NETWORK;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
