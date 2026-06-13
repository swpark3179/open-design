// Unit tests for the FabriX (Samsung SDS BYOK) media bridge in media.ts.
//
// FabriX is wired into the media-generation dispatcher via `fabrix:<modelId>`
// ids that bypass the static catalog and read credentials from the dedicated
// FabriX store (~/.open-design/fabrix.json, relocatable via
// OD_FABRIX_CONFIG_DIR). These tests assert:
//   1. A T2I model generates a PNG: POST to /openapi/chat/v1/message-with-models
//      with a multipart body and the FabriX auth headers, writing the decoded
//      base64 image into the project.
//   2. An I2T model analyzes a reference image: the streamed SSE text is
//      captured and written as a Markdown (.md) artifact.
//   3. A FabriX media id on a non-image surface is rejected.
//   4. An unconfigured FabriX store yields a clear error.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../src/media.js';

// 1×1 transparent PNG.
const FAKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ENDPOINT = 'https://fabrix.example.com';

interface FabrixModelSeed {
  modelId: string;
  name: string;
  types: string[];
}

async function writeFabrixStore(
  dir: string,
  models: FabrixModelSeed[],
  overrides: Record<string, unknown> = {},
) {
  await mkdir(dir, { recursive: true });
  const byType = (type: string) =>
    models.find((m) => m.types.map((t) => t.toUpperCase()).includes(type))?.modelId ?? null;
  const config = {
    endpointUrl: ENDPOINT,
    xFabrixClient: 'client-key',
    xOpenapiToken: 'pass-key',
    selectedModelId: models[0]?.modelId ?? null,
    models: models.map((m) => ({ ...m, description: '' })),
    defaultTextModelId: byType('TEXT'),
    defaultT2iModelId: byType('T2I'),
    defaultI2tModelId: byType('I2T'),
    updatedAt: 0,
    ...overrides,
  };
  await writeFile(path.join(dir, 'fabrix.json'), JSON.stringify(config), 'utf8');
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResp(frames: Array<Record<string, unknown>>) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('fabrix media bridge', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  let fabrixDir: string;
  const realFetch = globalThis.fetch;
  const originalFabrixDir = process.env.OD_FABRIX_CONFIG_DIR;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-fabrix-media-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    fabrixDir = path.join(root, 'fabrix-store');
    await mkdir(projectsRoot, { recursive: true });
    process.env.OD_FABRIX_CONFIG_DIR = fabrixDir;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (originalFabrixDir == null) delete process.env.OD_FABRIX_CONFIG_DIR;
    else process.env.OD_FABRIX_CONFIG_DIR = originalFabrixDir;
    await rm(root, { recursive: true, force: true });
  });

  it('generates a PNG from a T2I model via message-with-models', async () => {
    await writeFabrixStore(fabrixDir, [
      { modelId: 'text-model', name: 'Text', types: ['TEXT'] },
      { modelId: 'img-gen', name: 'Image Gen', types: ['T2I'] },
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResp({ actions: [{ answer: FAKE_PNG.toString('base64') }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia({
      surface: 'image',
      model: 'fabrix:img-gen',
      prompt: '강아지 그려줘',
      aspect: '1:1',
      output: 'dog.png',
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
    });

    expect(result.providerId).toBe('fabrix');
    expect(result.name).toBe('dog.png');
    expect(result.providerNote).toContain('fabrix/img-gen');

    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${ENDPOINT}/openapi/chat/v1/message-with-models`);
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.headers['x-fabrix-client']).toBe('client-key');
    expect(opts.headers['x-openapi-token']).toBe('pass-key');
    // Lead text model precedes the image model on the wire.
    const modelIds = (opts.body as FormData).getAll('modelIds');
    expect(modelIds).toEqual(['text-model', 'img-gen']);

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'dog.png'));
    expect(bytes.equals(FAKE_PNG)).toBe(true);
  });

  it('analyzes a reference image with an I2T model and writes Markdown', async () => {
    await writeFabrixStore(fabrixDir, [
      { modelId: 'text-model', name: 'Text', types: ['TEXT'] },
      { modelId: 'img-analyze', name: 'Image Analyze', types: ['I2T'] },
    ]);
    // Seed a reference image inside the project so resolveProjectImage accepts it.
    const projectDir = path.join(projectsRoot, 'project-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'ref.png'), FAKE_PNG);

    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResp([
        { event_status: 'CHUNK', content: 'This is ' },
        { event_status: 'CHUNK', content: 'a small cat.' },
        { status: 'SUCCESS', response_code: 'R20000' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia({
      surface: 'image',
      model: 'fabrix:img-analyze',
      prompt: 'describe the image',
      image: 'ref.png',
      output: 'analysis.png',
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
    });

    expect(result.providerId).toBe('fabrix');
    // Extension swapped to .md by the renderer's suggestedExt.
    expect(result.name).toBe('analysis.md');
    expect(result.kind).toBe('text');

    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${ENDPOINT}/openapi/chat/v1/message-with-models`);
    expect(opts.body).toBeInstanceOf(FormData);

    const md = await readFile(path.join(projectDir, 'analysis.md'), 'utf8');
    expect(md).toContain('This is a small cat.');
    expect(md).toContain('img-analyze');
  });

  it('rejects a FabriX media id on a non-image surface', async () => {
    await writeFabrixStore(fabrixDir, [
      { modelId: 'img-gen', name: 'Image Gen', types: ['T2I'] },
    ]);
    await expect(
      generateMedia({
        surface: 'video',
        model: 'fabrix:img-gen',
        prompt: 'a clip',
        projectRoot,
        projectsRoot,
        projectId: 'project-1',
      }),
    ).rejects.toThrow(/only support the image surface/);
  });

  it('errors clearly when FabriX is not configured', async () => {
    // No fabrix.json written → store is unconfigured.
    await expect(
      generateMedia({
        surface: 'image',
        model: 'fabrix:img-gen',
        prompt: 'a logo',
        projectRoot,
        projectsRoot,
        projectId: 'project-1',
      }),
    ).rejects.toThrow(/FabriX is not configured/);
  });
});
