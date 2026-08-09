import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";

import {
  CLOSED_NETWORK_FLAG_RELATIVE_PATH,
  closedNetworkEnvOverride,
  parseClosedNetworkFlagDocument,
} from "@open-design/contracts";

/**
 * @module closed-network
 *
 * The packaged shell's own read of the closed-network marker.
 *
 * The daemon is the authority for everything the UI sees, but two things run
 * BEFORE the daemon exists and therefore cannot ask it:
 *
 *  - the fatal-exit crash beacon in `startup-telemetry.ts`, which fires exactly
 *    when the daemon failed to come up, and
 *  - the desktop updater, which starts its feed poll 5 seconds after launch.
 *
 * So the packaged process resolves the marker itself and then exports the
 * answer as `OD_CLOSED_NETWORK` into the daemon and desktop child environments.
 * The daemon still re-resolves independently, which is what keeps `tools-dev`,
 * container, and headless launches working with no packaged shell involved.
 *
 * Only the flag's on/off decision is duplicated here — the document's `allow`
 * list is the daemon's business, and these two call sites are all-or-nothing.
 */

/** Shape of the `app-config.json` fields this module needs. Read defensively. */
interface PackagedAppConfigShape {
  projectLocations?: Array<{ path?: unknown }>;
}

function readMarkerAt(locationPath: string): boolean {
  if (!locationPath || !isAbsolute(locationPath)) return false;
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(locationPath, CLOSED_NETWORK_FLAG_RELATIVE_PATH), "utf8"),
    );
    return parseClosedNetworkFlagDocument(raw) !== null;
  } catch {
    return false;
  }
}

/**
 * Resolve closed-network mode from the packaged data root.
 *
 * Mirrors the daemon's precedence: an explicit `OD_CLOSED_NETWORK` wins, then a
 * marker at the top level of any configured project location (the built-in
 * `<dataRoot>/projects` included). Every failure path answers `false` so a
 * corrupt config can never turn a working install into a crippled one.
 */
export function resolvePackagedClosedNetwork(input: {
  dataRoot: string;
  env: NodeJS.ProcessEnv;
}): boolean {
  const override = closedNetworkEnvOverride(input.env);
  if (override !== undefined) return override;

  const candidates = [join(input.dataRoot, "projects")];
  try {
    const config = JSON.parse(
      readFileSync(join(input.dataRoot, "app-config.json"), "utf8"),
    ) as PackagedAppConfigShape;
    for (const location of config.projectLocations ?? []) {
      if (typeof location?.path === "string") candidates.push(location.path);
    }
  } catch {
    // No config yet (first launch) or an unreadable one — the built-in
    // location is still a valid place for an operator to drop the marker.
  }

  return candidates.some(readMarkerAt);
}
