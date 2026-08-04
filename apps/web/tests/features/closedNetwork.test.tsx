// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'open-design:closed-network';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Fresh module instance, so the load-time localStorage seed is re-evaluated. */
async function loadStore() {
  vi.resetModules();
  return import('../../src/features/closedNetwork');
}

describe('closed-network store', () => {
  it('defaults to off on a fresh profile', async () => {
    const { isClosedNetwork } = await loadStore();
    expect(isClosedNetwork()).toBe(false);
  });

  it('reflects the daemon answer for non-React readers', async () => {
    const { isClosedNetwork, setClosedNetwork } = await loadStore();
    setClosedNetwork(true);
    expect(isClosedNetwork()).toBe(true);
    setClosedNetwork(false);
    expect(isClosedNetwork()).toBe(false);
  });

  it('re-renders subscribed components when the daemon answer lands', async () => {
    const { setClosedNetwork, useClosedNetwork } = await loadStore();
    function Probe() {
      return <span data-testid="probe">{useClosedNetwork() ? 'closed' : 'open'}</span>;
    }

    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('open');

    act(() => setClosedNetwork(true));
    expect(screen.getByTestId('probe').textContent).toBe('closed');
  });

  // The point of the mirror: a machine already in closed-network mode must
  // paint the hidden state on the first frame rather than flashing the SNS
  // chrome for one daemon round-trip.
  it('seeds from localStorage so the first frame is already correct', async () => {
    const first = await loadStore();
    first.setClosedNetwork(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');

    const reloaded = await loadStore();
    expect(reloaded.isClosedNetwork()).toBe(true);
  });

  it('clears the seed when the daemon reports the mode is off', async () => {
    const first = await loadStore();
    first.setClosedNetwork(true);
    first.setClosedNetwork(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    const reloaded = await loadStore();
    expect(reloaded.isClosedNetwork()).toBe(false);
  });

  it('survives blocked storage without throwing', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { isClosedNetwork, setClosedNetwork } = await loadStore();

    expect(() => setClosedNetwork(true)).not.toThrow();
    // The in-memory value stays authoritative for this session; only the
    // first-frame optimisation is lost.
    expect(isClosedNetwork()).toBe(true);
    setItem.mockRestore();
  });
});

describe('fetchDaemonRuntimeFlags', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads closedNetwork from /api/daemon/status', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, closedNetwork: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    const { fetchDaemonRuntimeFlags } = await import('../../src/providers/registry');
    await expect(fetchDaemonRuntimeFlags()).resolves.toEqual({ closedNetwork: true });
  });

  // Guessing "closed" on a transient boot failure would hide working features
  // from every user whose daemon is briefly unreachable; the daemon is the
  // enforcement layer, so the UI errs toward showing things.
  it('falls back to open when the daemon is unreachable or the body is junk', async () => {
    const { fetchDaemonRuntimeFlags } = await import('../../src/providers/registry');

    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await expect(fetchDaemonRuntimeFlags()).resolves.toEqual({ closedNetwork: false });

    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(fetchDaemonRuntimeFlags()).resolves.toEqual({ closedNetwork: false });

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;
    await expect(fetchDaemonRuntimeFlags()).resolves.toEqual({ closedNetwork: false });
  });
});
