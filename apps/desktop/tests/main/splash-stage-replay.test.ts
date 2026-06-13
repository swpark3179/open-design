// Review follow-up on the splash boot-stage PR (#4223): the first stage
// update (the daemon phase) is fired from the packaged entry right after the
// splash window is created — potentially before the splash data-URL has
// finished loading and defined `window.__odSplashSetStage`. Without a
// load-ready guard that update reaches a renderer that has no setter yet, so
// the "Starting the local engine" label silently never renders on exactly the
// slow cold-boot path this feature targets.
//
// This spec pins the invariant with a structural mock (no real Electron):
// a stage fired before `did-finish-load` must be DEFERRED, not dropped, and
// replayed once the page reports it has loaded.

import { describe, expect, test } from 'vitest';

import {
  registerSplashStageTracking,
  setSplashStage,
  type SplashStageSurface,
} from '../../src/main/runtime.js';

type MockSplash = {
  surface: SplashStageSurface;
  executed: string[];
  emitDidFinishLoad: () => void;
  destroy: () => void;
};

function createMockSplash(): MockSplash {
  const executed: string[] = [];
  let didFinishLoad: (() => void) | null = null;
  let destroyed = false;
  const surface: SplashStageSurface = {
    isDestroyed: () => destroyed,
    webContents: {
      executeJavaScript: (code: string) => {
        executed.push(code);
        return Promise.resolve(undefined);
      },
      once: (event, listener) => {
        if (event === 'did-finish-load') didFinishLoad = listener;
      },
    },
  };
  return {
    surface,
    executed,
    emitDidFinishLoad: () => didFinishLoad?.(),
    destroy: () => {
      destroyed = true;
    },
  };
}

describe('splash boot-stage replay guard', () => {
  test('defers a stage fired before the page loads, then replays it on did-finish-load', () => {
    const splash = createMockSplash();
    registerSplashStageTracking(splash.surface);

    // Daemon phase fires while the splash data-URL is still loading. It must
    // NOT reach the renderer yet — the setter does not exist there.
    setSplashStage(splash.surface, 'engine');
    expect(splash.executed).toEqual([]);

    // Page reports loaded → the deferred stage is replayed exactly once.
    splash.emitDidFinishLoad();
    expect(splash.executed).toHaveLength(1);
    expect(splash.executed[0]).toContain('Starting the local engine');
  });

  test('replays only the latest stage when several arrive before load', () => {
    const splash = createMockSplash();
    registerSplashStageTracking(splash.surface);

    setSplashStage(splash.surface, 'engine');
    setSplashStage(splash.surface, 'interface');
    expect(splash.executed).toEqual([]);

    splash.emitDidFinishLoad();
    expect(splash.executed).toHaveLength(1);
    expect(splash.executed[0]).toContain('Preparing the interface');
  });

  test('applies immediately once the page has loaded', () => {
    const splash = createMockSplash();
    registerSplashStageTracking(splash.surface);
    splash.emitDidFinishLoad();

    setSplashStage(splash.surface, 'workspace');
    expect(splash.executed).toHaveLength(1);
    expect(splash.executed[0]).toContain('Opening your workspace');
  });

  test('is a no-op on a destroyed splash window', () => {
    const splash = createMockSplash();
    registerSplashStageTracking(splash.surface);
    splash.emitDidFinishLoad();
    splash.destroy();

    setSplashStage(splash.surface, 'engine');
    expect(splash.executed).toEqual([]);
  });
});
