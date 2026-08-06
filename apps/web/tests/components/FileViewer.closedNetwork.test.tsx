// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { FileViewer } from '../../src/components/FileViewer';
import {
  __resetClosedNetworkForTests,
  setClosedNetwork,
} from '../../src/features/closedNetwork';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  __resetClosedNetworkForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deployableHtmlFile(): ProjectFile {
  return {
    name: 'index.html',
    path: 'index.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Page',
      entry: 'index.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}

function renderViewer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ deployments: [] }), { status: 200 })),
  );
  return render(
    <FileViewer
      projectId="project-1"
      projectKind="prototype"
      file={deployableHtmlFile()}
      liveHtml="<html><body><h1>Hello</h1></body></html>"
    />,
  );
}

/** Opens the unified Share / Export / Send popover from the artifact chrome. */
function openUnifiedMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: /^share$/i }));
}

// Scoped to the popover's own tablist: the viewer chrome carries a second one
// (Preview / Code) that would otherwise be picked up by a bare `role=tab` query.
function unifiedTabs(): HTMLElement[] {
  const list = document.querySelector('.chrome-unified-tabs');
  return list ? Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')) : [];
}

function tabNames(): string[] {
  return unifiedTabs().map((tab) => tab.textContent ?? '');
}

describe('FileViewer share menu in closed-network mode', () => {
  // The trigger opens one popover with three tabs and only the Share tab is
  // outbound (copy/open a share page, Publish online, social share). Export and
  // Send write locally, so the popover survives and just loses that one tab —
  // this is why `canShareExternally` is a separate predicate from `canShare`.
  it('drops the Share tab but keeps Export and Send', () => {
    setClosedNetwork(true);
    renderViewer();
    openUnifiedMenu();

    expect(tabNames()).not.toContain('Share');
    expect(tabNames()).toContain('Export');
    expect(tabNames()).toContain('Send to...');
  });

  // Hiding the tab is not enough: the trigger must not land the user on a tab
  // that no longer exists, so it opens straight onto Export.
  it('opens the popover on Export instead of the missing Share tab', () => {
    setClosedNetwork(true);
    renderViewer();
    openUnifiedMenu();

    const selected = unifiedTabs()
      .filter((tab) => tab.getAttribute('aria-selected') === 'true')
      .map((tab) => tab.textContent ?? '');
    expect(selected).toEqual(['Export']);
  });

  // The counterweight: nothing about local artifact work changes offline.
  it('keeps the popover trigger available', () => {
    setClosedNetwork(true);
    renderViewer();

    expect(screen.getByRole('button', { name: /^share$/i })).not.toBeNull();
  });

  it('still offers the Share tab when the mode is off', () => {
    setClosedNetwork(false);
    renderViewer();
    openUnifiedMenu();

    expect(tabNames()).toContain('Share');
    expect(tabNames()).toContain('Export');
  });
});
