import fs from 'node:fs';
import path from 'node:path';

import {
  CLOSED_NETWORK_DISABLED_STATUS,
  CLOSED_NETWORK_FLAG_RELATIVE_PATH,
  closedNetworkEnvOverride,
  closedNetworkStatusFromDocument,
  parseClosedNetworkFlagDocument,
  type ClosedNetworkFlagDocument,
  type ClosedNetworkStatus,
} from '@open-design/contracts';

import { allProjectLocations } from './project-locations.js';
import { readAppConfigSync } from './app-config.js';
import { expandHomePrefix } from './home-expansion.js';

/**
 * @module closed-network
 *
 * Resolves whether this daemon runs in closed-network mode ("폐쇄망 모드").
 *
 * The decision is made ONCE at startup and then frozen for the process
 * lifetime, matching `OD_SANDBOX_MODE`. A mid-run flip would leave half the
 * daemon's caches, timers, and already-rendered UI on the other side of the
 * decision; `od closed-network enable` therefore tells the operator to restart.
 *
 * Precedence, highest first:
 *   1. `OD_CLOSED_NETWORK` env var (packaged shells set this after doing their
 *      own resolution, so the daemon they spawn cannot disagree with them).
 *   2. A `.open-design/closed-network.json` marker at the top level of ANY
 *      configured project location, built-in one included.
 *
 * Everything about this resolver fails toward the normal, fully-functional
 * app: an unreadable app-config, an unreachable location, a truncated marker,
 * or a marker without `closedNetwork: true` all leave the mode off.
 */

export interface ResolveClosedNetworkStatusInput {
  env: Record<string, string | undefined>;
  /** Resolved daemon data root (`RUNTIME_DATA_DIR`). */
  dataDir: string;
  /** The built-in project location root (`PROJECTS_DIR`). */
  projectsDir: string;
}

function readFlagFile(locationPath: string): { flagPath: string; raw: unknown } | null {
  const expanded = expandHomePrefix(locationPath.trim());
  if (!expanded || !path.isAbsolute(expanded)) return null;
  const flagPath = path.join(expanded, CLOSED_NETWORK_FLAG_RELATIVE_PATH);
  try {
    return { flagPath, raw: JSON.parse(fs.readFileSync(flagPath, 'utf8')) as unknown };
  } catch {
    // Missing file, unreadable directory, and malformed JSON are all "no
    // marker here" — never a reason to fail daemon startup.
    return null;
  }
}

/** Every project-location root the marker may live in, built-in one first. */
function candidateLocationPaths(input: ResolveClosedNetworkStatusInput): string[] {
  let configured: Array<{ path?: unknown }> = [];
  try {
    configured = readAppConfigSync(input.dataDir).projectLocations ?? [];
  } catch {
    // A corrupt app-config must not take the daemon down here; the built-in
    // location alone is still a valid place to look.
  }
  const paths = [
    input.projectsDir,
    ...configured.map((entry) => (typeof entry?.path === 'string' ? entry.path : '')),
  ];
  return Array.from(new Set(paths.filter((value) => value.trim().length > 0)));
}

export function resolveClosedNetworkStatus(
  input: ResolveClosedNetworkStatusInput,
): ClosedNetworkStatus {
  const override = closedNetworkEnvOverride(input.env);
  if (override === false) return CLOSED_NETWORK_DISABLED_STATUS;

  // Read the marker even when the env forces the mode on: an operator who set
  // both should still get the document's `allow` list honored.
  //
  // The scan stops at the first location whose file PARSES as a marker, not at
  // the first location that merely has a readable file there. A stale or
  // opted-out `closed-network.json` in one work base must not mask a real one
  // in the next — "any configured location carries the marker" is the rule.
  let found: { flagPath: string; document: ClosedNetworkFlagDocument } | null = null;
  for (const locationPath of candidateLocationPaths(input)) {
    const read = readFlagFile(locationPath);
    if (!read) continue;
    const document = parseClosedNetworkFlagDocument(read.raw);
    if (!document) continue;
    found = { flagPath: read.flagPath, document };
    break;
  }

  if (override === true) {
    return closedNetworkStatusFromDocument(found?.document ?? { closedNetwork: true, allow: [] }, {
      source: 'env',
      flagPath: found?.flagPath ?? null,
    });
  }

  if (!found) return CLOSED_NETWORK_DISABLED_STATUS;
  return closedNetworkStatusFromDocument(found.document, {
    source: 'flag-file',
    flagPath: found.flagPath,
  });
}

/**
 * Absolute path the `od closed-network enable/disable` subcommand writes to for
 * a given project location. Kept next to the resolver so the writer and the
 * reader can never drift apart on the filename.
 */
export function closedNetworkFlagPathFor(locationPath: string): string {
  return path.join(expandHomePrefix(locationPath.trim()), CLOSED_NETWORK_FLAG_RELATIVE_PATH);
}

/** The default project location to write a marker into when `--location` is omitted. */
export function defaultClosedNetworkFlagLocation(input: {
  dataDir: string;
  projectsDir: string;
}): string {
  try {
    const config = readAppConfigSync(input.dataDir);
    const locations = allProjectLocations(input.projectsDir, config.projectLocations);
    const preferred =
      locations.find((location) => location.id === config.defaultProjectLocationId) ?? locations[0];
    return preferred?.path ?? input.projectsDir;
  } catch {
    return input.projectsDir;
  }
}
