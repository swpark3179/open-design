import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const runtimeSource = readFileSync(new URL("../../src/main/runtime.ts", import.meta.url), "utf8");

/**
 * runtime.ts constructs three BrowserWindows (brand splash, desktop pet, main
 * app window), and the splash shares the `title: "Open Design"` /
 * `width: 1280` markers with the main app window. Scope matching to a single
 * constructor's options literal — a non-greedy whole-source regex anchors on
 * the FIRST `new BrowserWindow({` and silently locks onto the splash block.
 * The main app window is the only one that sets both the app title and a
 * preload script; requiring exactly one match keeps a future fourth window
 * from being checked ambiguously.
 */
function mainAppWindowOptions(): string {
  const optionBlocks = runtimeSource
    .split("new BrowserWindow({")
    .slice(1)
    .map((block) => block.slice(0, block.indexOf("});")));
  const mainBlocks = optionBlocks.filter(
    (block) => block.includes('title: "Open Design",') && block.includes("preload: preloadPath,"),
  );
  expect(mainBlocks).toHaveLength(1);
  return mainBlocks[0] ?? "";
}

describe("desktop BrowserWindow chrome options", () => {
  test("hides Electron's native menu bar in the Windows/Linux app window", () => {
    expect(mainAppWindowOptions()).toContain("autoHideMenuBar: true");
  });

  test("keeps macOS traffic-light controls clear of the web tab strip", () => {
    expect(runtimeSource).toContain("--app-chrome-traffic-space: 96px !important;");
    expect(runtimeSource).toContain("--app-chrome-traffic-margin: 12px !important;");
    expect(runtimeSource).toContain("flex: 0 0 96px !important;");
    expect(runtimeSource).toContain("width: 96px !important;");
  });

  test("keeps the visible renderer responsive when Chromium misclassifies visibility", () => {
    expect(mainAppWindowOptions()).toContain("backgroundThrottling: false");
  });
});
