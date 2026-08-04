import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DESKTOP_UPDATE_CHANNELS, SIDECAR_SOURCES } from "@open-design/sidecar-proto";
import { describe, expect, it } from "vitest";

import { DESKTOP_UPDATE_ENV, resolveDesktopUpdaterConfig } from "../../../src/main/updater/config.js";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "od-updater-config-test-"));
}

describe("desktop updater config", () => {
  it("defaults counted beta internal builds to the beta update channel", () => {
    const root = makeRoot();
    try {
      const config = resolveDesktopUpdaterConfig({
        currentVersion: "1.2.3-beta-internal.4",
        downloadRoot: root,
        env: {
          [DESKTOP_UPDATE_ENV.ENABLED]: "1",
        },
        source: SIDECAR_SOURCES.PACKAGED,
      });

      expect(config.channel).toBe(DESKTOP_UPDATE_CHANNELS.BETA);
      expect(config.metadataUrl).toContain("/beta/latest/metadata.json");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects a zero recurring update interval", () => {
    const root = makeRoot();
    try {
      expect(() =>
        resolveDesktopUpdaterConfig({
          currentVersion: "1.2.3-beta.4",
          downloadRoot: root,
          env: {
            [DESKTOP_UPDATE_ENV.CHECK_INTERVAL_MS]: "0",
            [DESKTOP_UPDATE_ENV.ENABLED]: "1",
          },
          source: SIDECAR_SOURCES.PACKAGED,
        }),
      ).toThrow(`${DESKTOP_UPDATE_ENV.CHECK_INTERVAL_MS} must be greater than 0 milliseconds`);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("defaults prerelease builds to the prerelease update channel", () => {
    const root = makeRoot();
    try {
      const config = resolveDesktopUpdaterConfig({
        currentVersion: "1.2.3-prerelease.4",
        downloadRoot: root,
        env: {
          [DESKTOP_UPDATE_ENV.ENABLED]: "1",
        },
        source: SIDECAR_SOURCES.PACKAGED,
      });

      expect(config.channel).toBe(DESKTOP_UPDATE_CHANNELS.PRERELEASE);
      expect(config.metadataUrl).toContain("/prerelease/latest/metadata.json");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("defaults preview builds to the preview update channel", () => {
    const root = makeRoot();
    try {
      const config = resolveDesktopUpdaterConfig({
        currentVersion: "1.2.3-preview.4",
        downloadRoot: root,
        env: {
          [DESKTOP_UPDATE_ENV.ENABLED]: "1",
        },
        source: SIDECAR_SOURCES.PACKAGED,
      });

      expect(config.channel).toBe(DESKTOP_UPDATE_CHANNELS.PREVIEW);
      expect(config.metadataUrl).toContain("/preview/latest/metadata.json");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  describe("closed-network mode", () => {
    // The poller is the one thing that reaches releases.open-design.ai on a
    // schedule with no user action, so it has to be off before the first
    // 5s-after-launch check fires. OD_UPDATE_ENABLED and OD_UPDATE_AUTO_CHECK
    // resolve independently, so both need the veto.
    it("forces the updater off even when the update env explicitly enables it", () => {
      const root = makeRoot();
      try {
        const config = resolveDesktopUpdaterConfig({
          currentVersion: "1.2.3",
          downloadRoot: root,
          env: {
            OD_CLOSED_NETWORK: "1",
            [DESKTOP_UPDATE_ENV.ENABLED]: "1",
            [DESKTOP_UPDATE_ENV.AUTO_CHECK]: "1",
          },
          source: SIDECAR_SOURCES.PACKAGED,
        });

        expect(config.enabled).toBe(false);
        expect(config.autoCheck).toBe(false);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    });

    it("accepts the same spellings the daemon does", () => {
      const root = makeRoot();
      try {
        for (const value of ["1", "true", "YES", " on "]) {
          const config = resolveDesktopUpdaterConfig({
            currentVersion: "1.2.3",
            downloadRoot: root,
            env: { OD_CLOSED_NETWORK: value },
            source: SIDECAR_SOURCES.PACKAGED,
          });
          expect(config.enabled, `OD_CLOSED_NETWORK=${value}`).toBe(false);
        }
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    });

    // Lenient on purpose: a typo must not take down the desktop shell. The
    // daemon reports the bad value with a hard error of its own.
    it("degrades an unrecognised value to off instead of throwing", () => {
      const root = makeRoot();
      try {
        const config = resolveDesktopUpdaterConfig({
          currentVersion: "1.2.3",
          downloadRoot: root,
          env: { OD_CLOSED_NETWORK: "nonsense" },
          source: SIDECAR_SOURCES.PACKAGED,
        });

        expect(config.enabled).toBe(true);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    });

    it("leaves the packaged default intact when the mode is off", () => {
      const root = makeRoot();
      try {
        const config = resolveDesktopUpdaterConfig({
          currentVersion: "1.2.3",
          downloadRoot: root,
          env: { OD_CLOSED_NETWORK: "0" },
          source: SIDECAR_SOURCES.PACKAGED,
        });

        expect(config.enabled).toBe(true);
        expect(config.autoCheck).toBe(true);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    });
  });
});
