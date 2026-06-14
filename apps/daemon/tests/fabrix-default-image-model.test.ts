// Tests for the FabriX image-generation default wiring.
//
// The FabriX BYOK panel lets the user pick a dedicated image-generation (T2I)
// model. That pick is stored in ~/.open-design/fabrix.json as
// `defaultT2iModelId` and must become the TOP-PRIORITY default image model the
// agent uses whenever it generates an image — both for media-surface projects
// (the media generation contract) and mid-chat in a non-media project (the
// dispatch hint). These tests assert:
//   1. resolveFabrixDefaultImageModel returns `fabrix:<id>` only when FabriX
//      is configured AND a T2I pick exists; otherwise null.
//   2. applyFabrixImageDefault rewrites the contract's default-image bullet.
//   3. composeSystemPrompt promotes the FabriX model on both surfaces.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveFabrixDefaultImageModel } from '../src/fabrix/config.js';
import { applyFabrixImageDefault } from '../src/prompts/media-contract.js';
import { composeSystemPrompt } from '../src/prompts/system.js';

const ENDPOINT = 'https://fabrix.example.com';

async function writeStore(dir: string, overrides: Record<string, unknown> = {}) {
  await mkdir(dir, { recursive: true });
  const config = {
    endpointUrl: ENDPOINT,
    xFabrixClient: 'client-key',
    xOpenapiToken: 'pass-key',
    selectedModelId: 'text-model',
    models: [
      { modelId: 'text-model', name: 'Text', description: '', types: ['TEXT'] },
      { modelId: 'img-gen', name: 'Image Gen', description: '', types: ['T2I'] },
      { modelId: 'img-analyze', name: 'Image Analyze', description: '', types: ['I2T'] },
    ],
    defaultTextModelId: 'text-model',
    defaultT2iModelId: 'img-gen',
    defaultI2tModelId: 'img-analyze',
    updatedAt: 0,
    ...overrides,
  };
  await writeFile(path.join(dir, 'fabrix.json'), JSON.stringify(config), 'utf8');
}

describe('resolveFabrixDefaultImageModel', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'od-fabrix-default-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the prefixed T2I pick when configured', async () => {
    await writeStore(dir);
    const env = { ...process.env, OD_FABRIX_CONFIG_DIR: dir };
    await expect(resolveFabrixDefaultImageModel(env)).resolves.toBe('fabrix:img-gen');
  });

  it('returns null when FabriX is not configured', async () => {
    const env = { ...process.env, OD_FABRIX_CONFIG_DIR: dir };
    // No fabrix.json written → unconfigured.
    await expect(resolveFabrixDefaultImageModel(env)).resolves.toBeNull();
  });

  it('returns null when configured but no T2I pick is set', async () => {
    await writeStore(dir, { defaultT2iModelId: null });
    const env = { ...process.env, OD_FABRIX_CONFIG_DIR: dir };
    await expect(resolveFabrixDefaultImageModel(env)).resolves.toBeNull();
  });
});

describe('applyFabrixImageDefault', () => {
  it('rewrites the default-image bullet to the FabriX model', () => {
    const base = `   - **Image, default / no preference stated**: use the project metadata's
     \`imageModel\` if set; otherwise use \`gpt-image-2\``;
    const out = applyFabrixImageDefault(base, 'fabrix:img-gen');
    expect(out).toContain('fabrix:img-gen');
    expect(out).toContain('TOP-PRIORITY');
    expect(out).not.toContain('otherwise use `gpt-image-2`');
  });
});

describe('composeSystemPrompt FabriX image default', () => {
  it('promotes the FabriX model in the media generation contract (image surface)', () => {
    const prompt = composeSystemPrompt({
      agentId: 'claude',
      metadata: { kind: 'image' },
      fabrixImageModel: 'fabrix:img-gen',
    });
    expect(prompt).toContain('fabrix:img-gen');
    expect(prompt).toContain('TOP-PRIORITY');
  });

  it('promotes the FabriX model in the mid-chat dispatch hint (non-media surface)', () => {
    const prompt = composeSystemPrompt({
      agentId: 'claude',
      metadata: { kind: 'other' },
      fabrixImageModel: 'fabrix:img-gen',
    });
    expect(prompt).toContain('Default image model (Samsung SDS FabriX is configured)');
    expect(prompt).toContain('--model fabrix:img-gen');
  });

  it('keeps the generic default when no FabriX model is configured', () => {
    const prompt = composeSystemPrompt({
      agentId: 'claude',
      metadata: { kind: 'image' },
    });
    expect(prompt).toContain('otherwise use `gpt-image-2`');
    expect(prompt).not.toContain('TOP-PRIORITY');
  });
});
