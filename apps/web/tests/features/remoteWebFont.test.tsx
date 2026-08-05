// @vitest-environment jsdom
//
// The Cairo webfont was a render-blocking CSS @import, so it fired on every
// load regardless of closed-network mode — the one renderer request the marker
// file could not turn off. These cases pin it to the flag.

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { __resetClosedNetworkForTests, setClosedNetwork } from '../../src/features/closedNetwork';
import { useRemoteWebFont } from '../../src/features/remoteWebFont';

function Probe() {
  useRemoteWebFont();
  return null;
}

function fontLinks(): HTMLLinkElement[] {
  return Array.from(document.head.querySelectorAll('link[rel="stylesheet"]')).filter((link) =>
    (link as HTMLLinkElement).href.includes('fonts.googleapis.com'),
  ) as HTMLLinkElement[];
}

afterEach(() => {
  cleanup();
  __resetClosedNetworkForTests();
  for (const link of fontLinks()) link.remove();
});

describe('remote webfont', () => {
  // The critical case: on a fresh profile the flag reads "not closed" until the
  // daemon answers. Acting on that guess would let the request escape a machine
  // that turns out to be locked down, and a sent request cannot be recalled.
  it('issues nothing before the daemon has answered', () => {
    render(<Probe />);
    expect(fontLinks()).toEqual([]);
  });

  it('attaches the stylesheet on a connected install', () => {
    setClosedNetwork(false);
    render(<Probe />);
    expect(fontLinks()).toHaveLength(1);
  });

  it('issues no font request in closed-network mode', () => {
    setClosedNetwork(true);
    render(<Probe />);
    expect(fontLinks()).toEqual([]);
  });

  it('drops the stylesheet when the daemon reports the mode on after boot', () => {
    setClosedNetwork(false);
    render(<Probe />);
    expect(fontLinks()).toHaveLength(1);

    act(() => setClosedNetwork(true));
    expect(fontLinks()).toEqual([]);
  });

  it('does not stack duplicate links across re-renders', () => {
    setClosedNetwork(false);
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    rerender(<Probe />);
    expect(fontLinks()).toHaveLength(1);
  });
});
