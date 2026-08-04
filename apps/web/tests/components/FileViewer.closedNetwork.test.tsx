// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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

describe('FileViewer share menu in closed-network mode', () => {
  // All three sections of the Share dropdown — copy/open a share page, Publish
  // online, and social share — need the public internet, so hiding them all
  // leaves nothing behind and the trigger goes with them.
  it('hides the Share trigger', () => {
    setClosedNetwork(true);
    renderViewer();

    expect(screen.queryByRole('button', { name: /^share$/i })).toBeNull();
  });

  // The counterweight: local artifact work must keep working offline. This is
  // why `canShareExternally` is a separate predicate from `canShare`, which
  // also gates the PPTX and image exports.
  it('keeps the Download menu available', () => {
    setClosedNetwork(true);
    renderViewer();

    expect(screen.getByRole('button', { name: /download/i })).not.toBeNull();
  });

  it('still shows both menus when the mode is off', () => {
    setClosedNetwork(false);
    renderViewer();

    expect(screen.getByRole('button', { name: /^share$/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /download/i })).not.toBeNull();
  });
});
