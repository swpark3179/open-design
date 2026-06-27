import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractText,
  getCustomProvider,
  renderBody,
  renderHeaders,
  type CustomByokTemplateContext,
} from '../src/byok-custom-providers.js';

// End-to-end exercise of the operations the POST /api/proxy/custom/stream
// route performs — config load → header/body render → real HTTP request →
// response text extraction — against a live loopback stub upstream. Loopback
// is permitted by the SSRF guard, so this runs without network egress.
describe('custom BYOK provider request pipeline', () => {
  let dir: string;
  let server: Server;
  let received: { headers: Record<string, unknown>; body: any } | null = null;
  let endpoint: string;
  const prevEnv = process.env.OD_BYOK_PROVIDERS_CONFIG;

  beforeEach(async () => {
    received = null;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received = {
          headers: req.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'pipeline ok' } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;

    dir = await mkdtemp(path.join(tmpdir(), 'byok-custom-int-'));
    const configPath = path.join(dir, 'byok-providers.local.json');
    process.env.OD_BYOK_PROVIDERS_CONFIG = configPath;
    await writeFile(
      configPath,
      JSON.stringify({
        providers: [
          {
            id: 'stub',
            label: 'Stub',
            endpoint,
            headers: { Authorization: 'Bearer sk-secret', 'X-Model': '{{model}}' },
            bodyTemplate: { model: '{{model}}', messages: '{{messages}}', max_tokens: 4096 },
            responseTextPath: 'choices.0.message.content',
            models: [{ id: 'stub-1', label: 'Stub 1' }],
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevEnv === undefined) delete process.env.OD_BYOK_PROVIDERS_CONFIG;
    else process.env.OD_BYOK_PROVIDERS_CONFIG = prevEnv;
    await rm(dir, { recursive: true, force: true });
  });

  it('renders the template, calls the endpoint, and extracts the response text', async () => {
    const provider = getCustomProvider('stub');
    expect(provider).not.toBeNull();

    const ctx: CustomByokTemplateContext = {
      model: 'stub-1',
      systemPrompt: '',
      prompt: 'hi',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 4096,
    };
    const headers = { 'Content-Type': 'application/json', ...renderHeaders(provider!.headers, ctx) };
    const body = renderBody(provider!.bodyTemplate, ctx);

    const resp = await fetch(provider!.endpoint, {
      method: provider!.method ?? 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    const text = extractText(json, provider!.responseTextPath);

    expect(text).toBe('pipeline ok');
    // The selected model id reached the body and the {{model}} header.
    expect(received?.body).toMatchObject({
      model: 'stub-1',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 4096,
    });
    expect(received?.headers.authorization).toBe('Bearer sk-secret');
    expect(received?.headers['x-model']).toBe('stub-1');
  });
});
