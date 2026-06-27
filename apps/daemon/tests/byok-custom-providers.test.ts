import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractText,
  getCustomProvider,
  listCustomProviders,
  loadCustomProviders,
  renderBody,
  renderHeaders,
  type CustomByokTemplateContext,
} from '../src/byok-custom-providers.js';

const ctx: CustomByokTemplateContext = {
  model: 'internal-7b',
  systemPrompt: 'be terse',
  prompt: 'hello',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 4096,
};

describe('renderBody', () => {
  it('interpolates scalar template variables inside strings', () => {
    const out = renderBody(
      { model: '{{model}}', system: 'sys: {{systemPrompt}}', cap: '{{maxTokens}}' },
      ctx,
    );
    expect(out).toEqual({ model: 'internal-7b', system: 'sys: be terse', cap: '4096' });
  });

  it('replaces an exact "{{messages}}" value with the message array', () => {
    const out = renderBody({ model: '{{model}}', messages: '{{messages}}' }, ctx) as Record<
      string,
      unknown
    >;
    expect(out.messages).toEqual(ctx.messages);
    expect(Array.isArray(out.messages)).toBe(true);
  });

  it('recurses into nested arrays and objects and leaves non-strings intact', () => {
    const out = renderBody(
      { stream: false, nested: [{ role: 'user', text: '{{prompt}}' }], n: 7 },
      ctx,
    );
    expect(out).toEqual({
      stream: false,
      nested: [{ role: 'user', text: 'hello' }],
      n: 7,
    });
  });
});

describe('renderHeaders', () => {
  it('interpolates scalars but keeps fixed values (including secrets) verbatim', () => {
    const out = renderHeaders(
      { Authorization: 'Bearer sk-fixed', 'X-Model': '{{model}}' },
      ctx,
    );
    expect(out).toEqual({ Authorization: 'Bearer sk-fixed', 'X-Model': 'internal-7b' });
  });
});

describe('extractText', () => {
  it('resolves a dotted path with array indices (OpenAI shape)', () => {
    const json = { choices: [{ message: { content: 'hi there' } }] };
    expect(extractText(json, 'choices.0.message.content')).toBe('hi there');
  });

  it('resolves an Anthropic-style content-block path', () => {
    const json = { content: [{ type: 'text', text: 'block text' }] };
    expect(extractText(json, 'content.0.text')).toBe('block text');
  });

  it('coerces numbers/booleans to strings', () => {
    expect(extractText({ n: 42 }, 'n')).toBe('42');
  });

  it('throws a descriptive error when the path does not resolve', () => {
    expect(() => extractText({ choices: [] }, 'choices.0.message.content')).toThrow(
      /responseTextPath/,
    );
  });

  it('throws when the resolved value is an object, not a scalar', () => {
    expect(() => extractText({ a: { b: {} } }, 'a.b')).toThrow(/expected a string/);
  });
});

describe('loadCustomProviders', () => {
  let dir: string;
  let configPath: string;
  const prevEnv = process.env.OD_BYOK_PROVIDERS_CONFIG;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'byok-custom-'));
    configPath = path.join(dir, 'byok-providers.local.json');
    process.env.OD_BYOK_PROVIDERS_CONFIG = configPath;
  });

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.OD_BYOK_PROVIDERS_CONFIG;
    else process.env.OD_BYOK_PROVIDERS_CONFIG = prevEnv;
    await rm(dir, { recursive: true, force: true });
  });

  const valid = {
    id: 'my-llm',
    label: 'My LLM',
    endpoint: 'https://api.example.com/v1/chat/completions',
    headers: { Authorization: 'Bearer sk-xxx' },
    bodyTemplate: { model: '{{model}}', messages: '{{messages}}' },
    responseTextPath: 'choices.0.message.content',
    models: [{ id: 'gpt-4o', label: 'GPT-4o' }, 'internal-7b'],
  };

  it('loads, normalizes models, and defaults method to POST', async () => {
    await writeFile(configPath, JSON.stringify({ providers: [valid] }));
    const providers = loadCustomProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]?.method).toBe('POST');
    expect(providers[0]?.models).toEqual([
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'internal-7b', label: 'internal-7b' },
    ]);
  });

  it('listCustomProviders omits endpoint, headers, and body (no secret leak)', async () => {
    await writeFile(configPath, JSON.stringify({ providers: [valid] }));
    const info = listCustomProviders();
    expect(info[0]).toEqual({
      id: 'my-llm',
      label: 'My LLM',
      models: [
        { id: 'gpt-4o', label: 'GPT-4o' },
        { id: 'internal-7b', label: 'internal-7b' },
      ],
    });
    expect(JSON.stringify(info)).not.toContain('sk-xxx');
    expect(JSON.stringify(info)).not.toContain('api.example.com');
  });

  it('getCustomProvider returns the full config for the proxy path', async () => {
    await writeFile(configPath, JSON.stringify({ providers: [valid] }));
    expect(getCustomProvider('my-llm')?.endpoint).toBe(valid.endpoint);
    expect(getCustomProvider('nope')).toBeNull();
  });

  it('rejects providers whose endpoint resolves to an internal/blocked address', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ providers: [{ ...valid, endpoint: 'http://10.0.0.5/v1' }] }),
    );
    expect(loadCustomProviders()).toHaveLength(0);
  });

  it('skips malformed entries (missing required fields) without throwing', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        providers: [
          { id: 'no-endpoint', label: 'x', headers: {}, bodyTemplate: {}, responseTextPath: 'a', models: [{ id: 'm' }] },
          { ...valid, id: 'no-models', models: [] },
          valid,
        ],
      }),
    );
    const providers = loadCustomProviders();
    expect(providers.map((p) => p.id)).toEqual(['my-llm']);
  });

  it('returns [] when the config file is absent', () => {
    process.env.OD_BYOK_PROVIDERS_CONFIG = path.join(dir, 'does-not-exist.json');
    expect(loadCustomProviders()).toEqual([]);
  });
});
