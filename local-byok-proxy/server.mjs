#!/usr/bin/env node
// Local OpenAI-compatible proxy shim for open-design BYOK ("approach B").
//
// open-design's BYOK chat runs through opencode + @ai-sdk/openai-compatible,
// which can ONLY speak the OpenAI wire format (GET /v1/models,
// POST /v1/chat/completions). The path suffix, headers, and body shape are all
// owned by that SDK and are NOT configurable from open-design Settings.
//
// This shim sits on localhost, presents a normal OpenAI-compatible surface, and
// delegates the ACTUAL upstream call (arbitrary URL / method / headers / body)
// to a config file's transform functions. So you get full control of path,
// headers, and body without touching open-design's product code.
//
//   opencode / open-design daemon ──OpenAI format──▶ THIS shim ──config──▶ any API
//
// Zero dependencies. Node 18+ (uses global fetch + node:http). Run:
//   node server.mjs [path/to/config.mjs]     (default: ./config.echo.mjs)
//
// Register in open-design Settings → API mode → OpenAI:
//   Base URL: http://localhost:<port>/v1
//   API Key:  the real secret your upstream needs (arrives here as Bearer)
//   Model:    an id returned by config.models() (or type it as Custom model)

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- load config ---------------------------------------------------------
const configArg = process.argv[2] ?? './config.echo.mjs';
const configPath = resolve(HERE, configArg);
let config;
try {
  const mod = await import(pathToFileURL(configPath).href);
  config = mod.config ?? mod.default;
  if (!config || typeof config !== 'object') {
    throw new Error('config module must export `config` (or default) object');
  }
} catch (err) {
  console.error(`[proxy] failed to load config "${configPath}":`, err?.message ?? err);
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? config.port ?? 8787);
const now = () => Math.floor(Date.now() / 1000);

// ---- small helpers -------------------------------------------------------
function bearer(req) {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  const x = req.headers['x-api-key'];
  return typeof x === 'string' ? x.trim() : '';
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return res({});
      try {
        res(JSON.parse(raw));
      } catch (e) {
        rej(new Error(`invalid JSON body: ${e.message}`));
      }
    });
    req.on('error', rej);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

function sendError(res, status, message, type = 'proxy_error') {
  sendJson(res, status, { error: { message, type } });
}

function mask(value) {
  if (typeof value !== 'string' || value.length <= 8) return value ? '***' : value;
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

// ---- OpenAI envelope builders -------------------------------------------
function chatCompletion(model, content, finishReason = 'stop') {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: now(),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: content ?? '' },
        finish_reason: finishReason,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function chunk(id, created, model, delta, finishReason = null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

// ---- upstream dispatch ---------------------------------------------------
// config.toUpstream(ctx) -> { url, method?, headers?, body? } | null
// A null/undefined spec (or missing hook) means "no real upstream" — the
// config fabricates the answer itself (echo/mock).
async function callUpstream(ctx) {
  if (typeof config.toUpstream !== 'function') return null;
  const spec = await config.toUpstream(ctx);
  if (!spec || !spec.url) return null;
  const method = spec.method ?? 'POST';
  const headers = { ...(spec.headers ?? {}) };
  const hasBody = spec.body !== undefined && method !== 'GET' && method !== 'HEAD';
  if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json';
  }
  console.log(`[proxy]   → upstream ${method} ${spec.url} (headers: ${Object.keys(headers).join(', ') || 'none'})`);
  return fetch(spec.url, {
    method,
    headers,
    ...(hasBody
      ? { body: typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body) }
      : {}),
    redirect: 'error',
  });
}

// ---- route: GET /v1/models ----------------------------------------------
async function handleModels(req, res) {
  const apiKey = bearer(req);
  let list = [];
  if (typeof config.models === 'function') {
    list = (await config.models({ apiKey })) ?? [];
  }
  const data = list.map((m) => {
    const id = typeof m === 'string' ? m : m.id;
    return { id, object: 'model', created: now(), owned_by: 'local-byok-proxy' };
  });
  console.log(`[proxy]   ← ${data.length} model(s)`);
  sendJson(res, 200, { object: 'list', data });
}

// ---- route: POST /v1/chat/completions -----------------------------------
async function handleChat(req, res) {
  const body = await readBody(req);
  const apiKey = bearer(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const model = typeof body.model === 'string' ? body.model : 'unknown';
  const stream = body.stream === true;
  const ctx = { messages, model, apiKey, stream, raw: body };
  console.log(`[proxy]   chat model=${model} stream=${stream} key=${mask(apiKey)} messages=${messages.length}`);

  if (stream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const id = `chatcmpl-${randomUUID()}`;
    const created = now();
    const write = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    // first chunk announces the assistant role
    write(chunk(id, created, model, { role: 'assistant' }));
    let upstream = null;
    try {
      upstream = await callUpstream(ctx);
    } catch (err) {
      write(chunk(id, created, model, { content: `\n[proxy upstream error] ${err.message}` }, 'stop'));
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    try {
      if (typeof config.streamUpstream === 'function') {
        for await (const delta of config.streamUpstream(upstream, ctx)) {
          if (delta) write(chunk(id, created, model, { content: String(delta) }));
        }
      } else {
        // no streaming hook: fall back to a single non-stream result
        const out = (await config.fromUpstream?.(upstream, ctx)) ?? { content: '' };
        if (out.content) write(chunk(id, created, model, { content: String(out.content) }));
      }
      write(chunk(id, created, model, {}, 'stop'));
    } catch (err) {
      write(chunk(id, created, model, { content: `\n[proxy transform error] ${err.message}` }, 'stop'));
    }
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  // non-streaming
  let upstream = null;
  try {
    upstream = await callUpstream(ctx);
  } catch (err) {
    return sendError(res, 502, `upstream fetch failed: ${err.message}`, 'upstream_error');
  }
  try {
    const out = (await config.fromUpstream?.(upstream, ctx)) ?? { content: '' };
    return sendJson(res, 200, chatCompletion(model, out.content, out.finishReason ?? 'stop'));
  } catch (err) {
    return sendError(res, 500, `transform failed: ${err.message}`, 'transform_error');
  }
}

// ---- server --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  console.log(`[proxy] ${req.method} ${path}`);
  try {
    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      return sendJson(res, 200, { ok: true, proxy: 'local-byok-proxy', config: configArg });
    }
    // tolerate both /v1/models and /models (open-design normalizes to /v1)
    if (req.method === 'GET' && /\/models$/.test(path)) return await handleModels(req, res);
    if (req.method === 'POST' && /\/chat\/completions$/.test(path)) return await handleChat(req, res);
    return sendError(res, 404, `no route for ${req.method} ${path}`, 'not_found');
  } catch (err) {
    console.error('[proxy] uncaught:', err);
    if (!res.headersSent) sendError(res, 500, err?.message ?? 'internal error');
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] local-byok-proxy listening on http://localhost:${PORT}`);
  console.log(`[proxy] config: ${configPath}`);
  console.log(`[proxy] register in open-design → OpenAI protocol, Base URL http://localhost:${PORT}/v1`);
});
