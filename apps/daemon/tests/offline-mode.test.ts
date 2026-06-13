// Offline/intranet fork: the OD_OFFLINE gate (default ON) must hard-disable
// every self-initiated external telemetry sink regardless of credentials in
// the environment. See docs/offline-mode.md.

import { describe, expect, it } from 'vitest';

import { isOfflineMode } from '../src/offline-mode.js';
import { readPosthogConfig, readPublicConfigResponse } from '../src/analytics.js';
import { readTelemetrySinkConfig } from '../src/langfuse-trace.js';

describe('isOfflineMode', () => {
  it('defaults to offline when OD_OFFLINE is unset', () => {
    expect(isOfflineMode({})).toBe(true);
  });

  it('treats 0/false/no/off as explicit opt-out', () => {
    for (const value of ['0', 'false', 'no', 'off', ' FALSE ', 'Off']) {
      expect(isOfflineMode({ OD_OFFLINE: value })).toBe(false);
    }
  });

  it('stays offline for any other value', () => {
    for (const value of ['1', 'true', 'yes', 'on', '']) {
      expect(isOfflineMode({ OD_OFFLINE: value })).toBe(true);
    }
  });
});

describe('offline telemetry gates', () => {
  it('disables PostHog even when POSTHOG_KEY is present', () => {
    expect(readPosthogConfig({ POSTHOG_KEY: 'phc_test' })).toBeNull();
    expect(readPublicConfigResponse({ POSTHOG_KEY: 'phc_test' })).toMatchObject({
      enabled: false,
      key: null,
      host: null,
    });
  });

  it('disables the Langfuse relay and direct sinks', () => {
    expect(
      readTelemetrySinkConfig({
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
      }),
    ).toBeNull();
  });
});
