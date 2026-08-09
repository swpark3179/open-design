import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveClosedNetworkStatus } from '../src/closed-network.js';

/** A data root with a built-in project location, plus optional external ones. */
function makeDataDir(externalLocations: string[] = []): {
  dataDir: string;
  projectsDir: string;
} {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'od-closed-network-'));
  const projectsDir = path.join(dataDir, 'projects');
  mkdirSync(projectsDir, { recursive: true });
  if (externalLocations.length > 0) {
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({
        projectLocations: externalLocations.map((p, index) => ({
          id: `loc-${index}`,
          name: `Location ${index}`,
          path: p,
        })),
      }),
      'utf8',
    );
  }
  return { dataDir, projectsDir };
}

function writeMarker(locationPath: string, body: unknown): string {
  const dir = path.join(locationPath, '.open-design');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'closed-network.json');
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return file;
}

function newDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'od-location-'));
}

describe('resolveClosedNetworkStatus', () => {
  it('is off when nothing asks for it', () => {
    const { dataDir, projectsDir } = makeDataDir();
    expect(resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir })).toEqual({
      enabled: false,
      source: null,
      flagPath: null,
      disabled: [],
    });
  });

  it('turns on from a marker in the built-in project location', () => {
    const { dataDir, projectsDir } = makeDataDir();
    const flagPath = writeMarker(projectsDir, { schemaVersion: 1, closedNetwork: true });
    const status = resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir });
    expect(status.enabled).toBe(true);
    expect(status.source).toBe('flag-file');
    expect(status.flagPath).toBe(flagPath);
    expect(status.disabled).toContain('community-links');
  });

  // The realistic corporate shape: IT provisions the shared work base the user
  // added in Settings, not the daemon's built-in folder.
  it('turns on from a marker in any configured project location', () => {
    const external = newDir();
    const { dataDir, projectsDir } = makeDataDir([external]);
    const flagPath = writeMarker(external, { closedNetwork: true });
    const status = resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir });
    expect(status.enabled).toBe(true);
    expect(status.flagPath).toBe(flagPath);
  });

  // A stale or opted-out marker in one work base must not mask a real one in
  // the next: the scan advances on a file that parses but does not opt in, and
  // only stops on a genuine marker.
  it('keeps scanning past a location whose marker does not opt in', () => {
    const optedOut = newDir();
    const optedIn = newDir();
    const { dataDir, projectsDir } = makeDataDir([optedOut, optedIn]);
    writeMarker(optedOut, { schemaVersion: 1, closedNetwork: false });
    const flagPath = writeMarker(optedIn, { schemaVersion: 1, closedNetwork: true });

    const status = resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir });
    expect(status.enabled).toBe(true);
    expect(status.flagPath).toBe(flagPath);
  });

  it('keeps scanning past a location whose marker is malformed', () => {
    const broken = newDir();
    const good = newDir();
    const { dataDir, projectsDir } = makeDataDir([broken, good]);
    writeMarker(broken, '{ not json');
    const flagPath = writeMarker(good, { closedNetwork: true });

    expect(resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir }).flagPath).toBe(flagPath);
  });

  it('honors the allow list from the marker', () => {
    const { dataDir, projectsDir } = makeDataDir();
    writeMarker(projectsDir, { closedNetwork: true, allow: ['auto-update'] });
    const status = resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir });
    expect(status.disabled).not.toContain('auto-update');
    expect(status.disabled).toContain('telemetry');
  });

  it('stays off when the marker is malformed', () => {
    const { dataDir, projectsDir } = makeDataDir();
    writeMarker(projectsDir, '{ not json');
    expect(resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir }).enabled).toBe(false);
  });

  it('stays off when the marker does not opt in', () => {
    const { dataDir, projectsDir } = makeDataDir();
    writeMarker(projectsDir, { schemaVersion: 1, closedNetwork: false });
    expect(resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir }).enabled).toBe(false);
  });

  it('survives an unreadable app-config by falling back to the built-in location', () => {
    const { dataDir, projectsDir } = makeDataDir();
    writeFileSync(path.join(dataDir, 'app-config.json'), '{ broken', 'utf8');
    writeMarker(projectsDir, { closedNetwork: true });
    expect(resolveClosedNetworkStatus({ env: {}, dataDir, projectsDir }).enabled).toBe(true);
  });

  describe('OD_CLOSED_NETWORK', () => {
    it('turns the mode on with no marker present', () => {
      const { dataDir, projectsDir } = makeDataDir();
      const status = resolveClosedNetworkStatus({
        env: { OD_CLOSED_NETWORK: '1' },
        dataDir,
        projectsDir,
      });
      expect(status.enabled).toBe(true);
      expect(status.source).toBe('env');
      expect(status.flagPath).toBeNull();
    });

    // The packaged shell stamps the env after reading the marker itself, so
    // both are set on a real packaged launch — the document's allow list has to
    // survive that, or `allow` would silently stop working once packaged.
    it('still honors a marker allow list when both are present', () => {
      const { dataDir, projectsDir } = makeDataDir();
      const flagPath = writeMarker(projectsDir, {
        closedNetwork: true,
        allow: ['message-center'],
      });
      const status = resolveClosedNetworkStatus({
        env: { OD_CLOSED_NETWORK: 'true' },
        dataDir,
        projectsDir,
      });
      expect(status.source).toBe('env');
      expect(status.flagPath).toBe(flagPath);
      expect(status.disabled).not.toContain('message-center');
    });

    it('forces the mode off even when a marker exists', () => {
      const { dataDir, projectsDir } = makeDataDir();
      writeMarker(projectsDir, { closedNetwork: true });
      expect(
        resolveClosedNetworkStatus({
          env: { OD_CLOSED_NETWORK: '0' },
          dataDir,
          projectsDir,
        }).enabled,
      ).toBe(false);
    });

    it('ignores an unrecognized value and falls through to the marker', () => {
      const { dataDir, projectsDir } = makeDataDir();
      writeMarker(projectsDir, { closedNetwork: true });
      const status = resolveClosedNetworkStatus({
        env: { OD_CLOSED_NETWORK: 'perhaps' },
        dataDir,
        projectsDir,
      });
      expect(status.enabled).toBe(true);
      expect(status.source).toBe('flag-file');
    });
  });
});
