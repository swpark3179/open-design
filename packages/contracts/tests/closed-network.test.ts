import { describe, expect, it } from 'vitest';

import {
  CLOSED_NETWORK_CAPABILITIES,
  CLOSED_NETWORK_DISABLED_STATUS,
  closedNetworkEnvOverride,
  closedNetworkStatusFromDocument,
  isClosedNetworkCapabilityDisabled,
  parseClosedNetworkFlagDocument,
} from '../src/api/closed-network.js';

describe('parseClosedNetworkFlagDocument', () => {
  it('accepts a minimal marker', () => {
    expect(parseClosedNetworkFlagDocument({ schemaVersion: 1, closedNetwork: true })).toEqual({
      closedNetwork: true,
      allow: [],
    });
  });

  it('keeps recognized capabilities in allow and drops the rest', () => {
    expect(
      parseClosedNetworkFlagDocument({
        closedNetwork: true,
        allow: ['auto-update', 'not-a-capability', 'auto-update'],
      }),
    ).toEqual({ closedNetwork: true, allow: ['auto-update'] });
  });

  // The safety-critical direction: anything unrecognizable must leave the app
  // in its normal, fully-functional state rather than half-disabling it.
  it.each([
    ['missing closedNetwork', { schemaVersion: 1 }],
    ['closedNetwork false', { closedNetwork: false }],
    ['closedNetwork as a string', { closedNetwork: 'true' }],
    ['an array', [{ closedNetwork: true }]],
    ['null', null],
    ['a bare string', 'closedNetwork'],
  ])('rejects %s', (_label, input) => {
    expect(parseClosedNetworkFlagDocument(input)).toBeNull();
  });
});

describe('closedNetworkStatusFromDocument', () => {
  it('disables every capability when allow is empty', () => {
    const status = closedNetworkStatusFromDocument(
      { closedNetwork: true, allow: [] },
      { source: 'flag-file', flagPath: '/work/.open-design/closed-network.json' },
    );
    expect(status.enabled).toBe(true);
    expect(status.source).toBe('flag-file');
    expect(status.flagPath).toBe('/work/.open-design/closed-network.json');
    expect(status.disabled).toEqual([...CLOSED_NETWORK_CAPABILITIES]);
  });

  it('leaves allowed capabilities enabled', () => {
    const status = closedNetworkStatusFromDocument(
      { closedNetwork: true, allow: ['auto-update'] },
      { source: 'env', flagPath: null },
    );
    expect(status.disabled).not.toContain('auto-update');
    expect(status.disabled).toContain('community-links');
    expect(isClosedNetworkCapabilityDisabled(status, 'auto-update')).toBe(false);
    expect(isClosedNetworkCapabilityDisabled(status, 'social-share')).toBe(true);
  });
});

describe('isClosedNetworkCapabilityDisabled', () => {
  // Guard sites call this before the daemon's answer has landed, so an absent
  // status must read as "normal app", never as "hide everything".
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the off status', CLOSED_NETWORK_DISABLED_STATUS],
  ])('reports nothing disabled for %s', (_label, status) => {
    for (const capability of CLOSED_NETWORK_CAPABILITIES) {
      expect(isClosedNetworkCapabilityDisabled(status, capability)).toBe(false);
    }
  });
});

describe('closedNetworkEnvOverride', () => {
  it.each(['1', 'true', 'yes', 'on', ' TRUE '])('reads %j as on', (value) => {
    expect(closedNetworkEnvOverride({ OD_CLOSED_NETWORK: value })).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', ''])('reads %j as off', (value) => {
    expect(closedNetworkEnvOverride({ OD_CLOSED_NETWORK: value })).toBe(false);
  });

  it('returns undefined when unset so the flag file decides', () => {
    expect(closedNetworkEnvOverride({})).toBeUndefined();
  });

  // Unlike OD_SANDBOX_MODE this must not throw: refusing to boot over a typo'd
  // network-policy hint would be worse than ignoring the hint.
  it('ignores an unrecognized value instead of throwing', () => {
    expect(closedNetworkEnvOverride({ OD_CLOSED_NETWORK: 'maybe' })).toBeUndefined();
  });
});
