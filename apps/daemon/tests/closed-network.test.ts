import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CLOSED_NETWORK_ENV,
  CLOSED_NETWORK_MARKER_FILENAME,
  ClosedNetworkError,
  assertOutboundAllowed,
  closedNetworkMarkerPath,
  closedNetworkUserStateDir,
  isClosedNetworkEnabled,
  isClosedNetworkError,
  parseClosedNetworkEnvValue,
} from '../src/closed-network.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** A user-state dir with no marker in it. */
function tempStateDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'od-closed-network-'));
  tempDirs.push(dir);
  return dir;
}

/** A user-state dir with the marker file present. */
function tempStateDirWithMarker(contents = ''): string {
  const dir = tempStateDir();
  writeFileSync(path.join(dir, CLOSED_NETWORK_MARKER_FILENAME), contents);
  return dir;
}

describe('closed-network env parsing', () => {
  it('is disabled when OD_CLOSED_NETWORK is unset or false-like', () => {
    const OD_USER_STATE_DIR = tempStateDir();
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR })).toBe(false);
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR, OD_CLOSED_NETWORK: '0' })).toBe(false);
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR, OD_CLOSED_NETWORK: 'false' })).toBe(false);
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR, OD_CLOSED_NETWORK: 'off' })).toBe(false);
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR, OD_CLOSED_NETWORK: '' })).toBe(false);
  });

  it('is enabled for explicit true-like values', () => {
    const OD_USER_STATE_DIR = tempStateDir();
    for (const value of ['1', 'true', 'YES', ' on ']) {
      expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR, OD_CLOSED_NETWORK: value })).toBe(true);
    }
  });

  it('rejects ambiguous non-empty values instead of silently defaulting to off', () => {
    expect(() => parseClosedNetworkEnvValue('intranet')).toThrow(
      `${CLOSED_NETWORK_ENV} must be one of`,
    );
    expect(() =>
      isClosedNetworkEnabled({ OD_USER_STATE_DIR: tempStateDir(), OD_CLOSED_NETWORK: 'intranet' }),
    ).toThrow(`${CLOSED_NETWORK_ENV} must be one of`);
  });

  it('returns null for an unset variable so callers can fall through', () => {
    expect(parseClosedNetworkEnvValue(undefined)).toBeNull();
  });
});

describe('closed-network marker file', () => {
  it('enables the mode by its presence alone, whatever it contains', () => {
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR: tempStateDirWithMarker() })).toBe(true);
    expect(
      isClosedNetworkEnabled({ OD_USER_STATE_DIR: tempStateDirWithMarker('anything at all') }),
    ).toBe(true);
  });

  // The whole point of the marker being administrator-owned: a per-user env
  // var must not be able to unlock a machine that was locked down centrally.
  it('outranks OD_CLOSED_NETWORK=0', () => {
    const OD_USER_STATE_DIR = tempStateDirWithMarker();
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR, OD_CLOSED_NETWORK: '0' })).toBe(true);
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR, OD_CLOSED_NETWORK: 'false' })).toBe(true);
  });

  // Reached before the strict env parse, so a locked-down machine boots even
  // when some stale profile exports a garbage value.
  it('outranks an invalid OD_CLOSED_NETWORK rather than throwing', () => {
    const OD_USER_STATE_DIR = tempStateDirWithMarker();
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR, OD_CLOSED_NETWORK: 'nonsense' })).toBe(true);
  });

  it('honours OD_USER_STATE_DIR and defaults to ~/.open-design', () => {
    const OD_USER_STATE_DIR = tempStateDir();
    expect(closedNetworkUserStateDir({ OD_USER_STATE_DIR })).toBe(OD_USER_STATE_DIR);
    expect(closedNetworkMarkerPath({ OD_USER_STATE_DIR })).toBe(
      path.join(OD_USER_STATE_DIR, CLOSED_NETWORK_MARKER_FILENAME),
    );
    expect(closedNetworkUserStateDir({})).toBe(path.join(os.homedir(), '.open-design'));
  });

  it('expands a ~ prefix in OD_USER_STATE_DIR', () => {
    expect(closedNetworkUserStateDir({ OD_USER_STATE_DIR: '~/custom-state' })).toBe(
      path.join(os.homedir(), 'custom-state'),
    );
  });

  it('treats an unreadable state dir as "no marker" rather than failing startup', () => {
    // A path whose parent is a regular file: existsSync answers false, and the
    // daemon must boot in normal mode instead of crashing.
    const dir = tempStateDir();
    const notADir = path.join(dir, 'file');
    writeFileSync(notADir, '');
    expect(isClosedNetworkEnabled({ OD_USER_STATE_DIR: notADir })).toBe(false);
  });
});

describe('assertOutboundAllowed', () => {
  it('is a no-op when the mode is off', () => {
    expect(() => assertOutboundAllowed(false, 'GitHub repository metadata')).not.toThrow();
  });

  it('throws a typed, identifiable error when the mode is on', () => {
    let caught: unknown;
    try {
      assertOutboundAllowed(true, 'GitHub repository metadata');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ClosedNetworkError);
    expect(isClosedNetworkError(caught)).toBe(true);
    expect((caught as ClosedNetworkError).code).toBe('closed-network');
    expect((caught as Error).message).toContain('GitHub repository metadata');
  });

  it('does not mistake an ordinary upstream failure for a policy refusal', () => {
    expect(isClosedNetworkError(new Error('HTTP 502'))).toBe(false);
  });
});
