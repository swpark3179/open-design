import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLOSED_NETWORK_ENV,
  CLOSED_NETWORK_FLAG,
  CLOSED_NETWORK_MARKER_FILENAME,
  closedNetworkMarkerPath,
  closedNetworkUserStateDir,
  isClosedNetworkEnvLoose,
  parseClosedNetworkArgs,
  parseClosedNetworkEnvValue,
  resolveClosedNetwork,
} from "../src/closed-network.js";

// This suite is the drift guard for the deliberate twin of
// apps/daemon/src/closed-network.ts. The precedence table asserted here must
// stay identical to apps/daemon/tests/closed-network.test.ts — if the two ever
// disagree, the packaged shell and the daemon it spawns end up in different
// modes, which is exactly the failure the duplication risks.

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "od-packaged-closed-network-"));
  tempDirs.push(dir);
  return dir;
}

function tempStateDirWithMarker(): string {
  const dir = tempStateDir();
  writeFileSync(join(dir, CLOSED_NETWORK_MARKER_FILENAME), "");
  return dir;
}

describe("packaged closed-network resolution", () => {
  it("is off with no marker, no env, and no flag", () => {
    expect(resolveClosedNetwork({ env: { OD_USER_STATE_DIR: tempStateDir() } })).toBe(false);
  });

  it("turns on from the launch flag alone", () => {
    expect(
      resolveClosedNetwork({ env: { OD_USER_STATE_DIR: tempStateDir() }, flag: true }),
    ).toBe(true);
  });

  it("turns on from the env var alone", () => {
    expect(
      resolveClosedNetwork({
        env: { OD_USER_STATE_DIR: tempStateDir(), OD_CLOSED_NETWORK: "1" },
      }),
    ).toBe(true);
  });

  it("turns on from the marker file alone", () => {
    expect(resolveClosedNetwork({ env: { OD_USER_STATE_DIR: tempStateDirWithMarker() } })).toBe(
      true,
    );
  });

  // Same authority rule as the daemon: a per-user env var cannot unlock a
  // machine an administrator locked down with the marker file.
  it("lets the marker file outrank OD_CLOSED_NETWORK=0", () => {
    expect(
      resolveClosedNetwork({
        env: { OD_USER_STATE_DIR: tempStateDirWithMarker(), OD_CLOSED_NETWORK: "0" },
      }),
    ).toBe(true);
  });

  it("lets the marker file outrank an invalid env value rather than throwing", () => {
    expect(
      resolveClosedNetwork({
        env: { OD_USER_STATE_DIR: tempStateDirWithMarker(), OD_CLOSED_NETWORK: "nonsense" },
      }),
    ).toBe(true);
  });

  it("rejects an ambiguous env value when no marker is present", () => {
    expect(() =>
      resolveClosedNetwork({
        env: { OD_USER_STATE_DIR: tempStateDir(), OD_CLOSED_NETWORK: "nonsense" },
      }),
    ).toThrow(`${CLOSED_NETWORK_ENV} must be one of`);
  });

  it("accepts the same true-like and false-like spellings as the daemon", () => {
    for (const value of ["1", "true", "YES", " on "]) {
      expect(parseClosedNetworkEnvValue(value)).toBe(true);
    }
    for (const value of ["0", "false", "NO", "off", ""]) {
      expect(parseClosedNetworkEnvValue(value)).toBe(false);
    }
    expect(parseClosedNetworkEnvValue(undefined)).toBeNull();
  });
});

describe("packaged closed-network paths", () => {
  it("defaults the state dir to ~/.open-design and honours OD_USER_STATE_DIR", () => {
    const home = join("/", "home", "tester");
    expect(closedNetworkUserStateDir({}, home)).toBe(join(home, ".open-design"));

    const override = tempStateDir();
    expect(closedNetworkUserStateDir({ OD_USER_STATE_DIR: override }, home)).toBe(override);
    expect(closedNetworkMarkerPath({ OD_USER_STATE_DIR: override }, home)).toBe(
      join(override, CLOSED_NETWORK_MARKER_FILENAME),
    );
  });

  it("expands a ~ prefix in OD_USER_STATE_DIR", () => {
    const home = homedir();
    expect(closedNetworkUserStateDir({ OD_USER_STATE_DIR: "~/custom-state" }, home)).toBe(
      join(home, "custom-state"),
    );
  });
});

describe("packaged closed-network argv", () => {
  it("detects the flag anywhere in argv and ignores unrelated args", () => {
    expect(parseClosedNetworkArgs([CLOSED_NETWORK_FLAG])).toBe(true);
    expect(parseClosedNetworkArgs(["--headless", CLOSED_NETWORK_FLAG])).toBe(true);
    expect(parseClosedNetworkArgs([])).toBe(false);
    expect(parseClosedNetworkArgs(["--headless", "--closed-networking"])).toBe(false);
  });
});

describe("isClosedNetworkEnvLoose", () => {
  // Used only on never-throw paths (crash reporting), where a typo must
  // degrade to "off" instead of taking the reporter down with it.
  it("never throws on a bad value", () => {
    expect(isClosedNetworkEnvLoose({ OD_CLOSED_NETWORK: "nonsense" })).toBe(false);
    expect(isClosedNetworkEnvLoose({})).toBe(false);
    expect(isClosedNetworkEnvLoose({ OD_CLOSED_NETWORK: "1" })).toBe(true);
    expect(isClosedNetworkEnvLoose({ OD_CLOSED_NETWORK: " ON " })).toBe(true);
  });
});
