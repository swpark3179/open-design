// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenDesignGithubRepoResponse } from '@open-design/contracts';

const originalFetch = globalThis.fetch;

/**
 * Import the badge and put the closed-network store where these cases live: a
 * connected install whose daemon has answered.
 *
 * The hook now waits for that answer before reaching out — the bare flag reads
 * "open" on a fresh profile until the daemon replies, which is long enough for
 * a request to escape a machine that turns out to be locked down. Resolving it
 * here has to go through the same module instance the component got, hence the
 * dynamic import beside it (`vi.resetModules()` runs between cases).
 */
async function importBadgeOnAConnectedInstall() {
  const badge = await import('../../src/components/GithubStarBadge');
  const { setClosedNetwork } = await import('../../src/features/closedNetwork');
  setClosedNetwork(false);
  return badge;
}

describe('GithubStarBadge', () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.localStorage?.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses the daemon-backed GitHub endpoint and keeps a fallback label on failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    const { GithubStarBadge } = await importBadgeOnAConnectedInstall();

    render(<GithubStarBadge />);

    expect(screen.getByText('Star')).toBeTruthy();
    expect(screen.getByText('40K+')).toBeTruthy();
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/github/open-design',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('backs off after an offline failure instead of retrying on every remount', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    const { GithubStarBadge } = await importBadgeOnAConnectedInstall();

    render(<GithubStarBadge />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    cleanup();

    render(<GithubStarBadge />);

    expect(screen.getByText('40K+')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('backs off when the daemon returns an offline 502 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } satisfies Partial<Response>) as typeof fetch;
    const { GithubStarBadge } = await importBadgeOnAConnectedInstall();

    render(<GithubStarBadge />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    cleanup();

    render(<GithubStarBadge />);

    expect(screen.getByText('40K+')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not back off after effect cleanup aborts an in-flight request', async () => {
    const fetchCalls: AbortSignal[] = [];
    globalThis.fetch = vi.fn((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error('expected fetch to receive an AbortSignal');
      }
      fetchCalls.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      });
    }) as typeof fetch;
    const { GithubStarBadge } = await importBadgeOnAConnectedInstall();

    render(<GithubStarBadge />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(<GithubStarBadge />);

    expect(fetchCalls[0]?.aborted).toBe(true);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
  });

  // Observed on a real closed-network runtime: two 503s from
  // /api/github/open-design on every boot. The hook read the bare flag, which
  // is `false` on a fresh profile until the daemon answers — so the guard was
  // reliably evaluated in the one window where it could not hold.
  it('does not reach out before the daemon has resolved the mode', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    const { GithubStarBadge } = await import('../../src/components/GithubStarBadge');

    render(<GithubStarBadge />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not reach out on a closed-network install', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    const { GithubStarBadge } = await import('../../src/components/GithubStarBadge');
    const { setClosedNetwork } = await import('../../src/features/closedNetwork');
    setClosedNetwork(true);

    render(<GithubStarBadge />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('renders the live star count returned by the daemon endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        repo: 'nexu-io/open-design',
        stargazers_count: 42137,
        fetchedAt: Date.parse('2026-05-22T00:00:00.000Z'),
        stale: false,
      } satisfies OpenDesignGithubRepoResponse),
    } satisfies Partial<Response>) as typeof fetch;
    const { GithubStarBadge } = await importBadgeOnAConnectedInstall();

    render(<GithubStarBadge />);

    await waitFor(() => expect(screen.getByText('42.1K')).toBeTruthy());
  });
});
