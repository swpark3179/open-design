# local-byok-proxy

A tiny, zero-dependency **local OpenAI-compatible proxy** that lets you plug a
*completely different* API into open-design's BYOK mode — with full control over
the request **path, headers, and body** that open-design's Settings cannot
customize on their own.

## Why

open-design's BYOK chat runs through opencode + `@ai-sdk/openai-compatible`.
That SDK only speaks the OpenAI wire format (`GET /v1/models`,
`POST /v1/chat/completions`), and the exact URL suffix / headers / body shape are
owned by the SDK — not exposed in Settings. This proxy presents that OpenAI
surface on `localhost` and translates each call to whatever your real API needs,
via plain JS functions in a config file.

```
opencode (@ai-sdk/openai-compatible) ──OpenAI format──▶ local-byok-proxy ──your config──▶ any API
open-design daemon (/api/provider/models, /api/test/connection) ─────────────────────────▶ local-byok-proxy
```

BYOK allows loopback base URLs (`localhost` / `127.0.0.1`) as an SSRF carve-out,
so no core changes are needed — you just register the proxy in Settings.

> This folder is a personal, local-only tool. It is **not** open-design product
> code and is not meant to be committed/pushed.

## Requirements

- Node 18+ (uses global `fetch` and `node:http`). Verified on Node 22.
- No `npm install` needed.

## Run

```bash
# echo demo (no real upstream — just proves the pipe works)
node local-byok-proxy/server.mjs config.echo.mjs

# your real target
node local-byok-proxy/server.mjs config.example.mjs
```

The port comes from `PORT` env var, else `config.port`, else `8787`.

## Register in open-design

Settings → API mode → **OpenAI** protocol:

| Field | Value |
|---|---|
| Base URL | `http://localhost:8787/v1` |
| API Key | the real secret your upstream needs (the proxy reads it from the `Bearer` header and hands it to your config as `ctx.apiKey`) |
| Model | an id returned by `config.models()` — or type any id via **Custom model** |

## The config contract

A config module exports `config` (or a default export) with these hooks. Only
`models` + one of (`fromUpstream` / `streamUpstream`) are required.

```js
export const config = {
  port: 8787,

  // GET /v1/models — the Settings dropdown. Static list or a live fetch.
  async models({ apiKey }) { return [{ id: 'my-model', label: 'My Model' }]; },

  // Map incoming OpenAI request -> your upstream call.
  // Return { url, method?, headers?, body? } or null (= no real upstream).
  toUpstream(ctx) {
    return {
      url: 'https://target.example.com/any/path',
      method: 'POST',
      headers: { 'x-custom-auth': ctx.apiKey, 'x-tenant': 'foo' }, // any headers
      body: { prompt: ctx.messages.map((m) => m.content).join('\n') }, // any body
    };
  },

  // Non-streaming: upstream Response (or null) -> assistant text.
  async fromUpstream(upstream, ctx) {
    const j = await upstream.json();
    return { content: j.result.text };
  },

  // Streaming: yield text deltas. `upstream` is the raw fetch Response.
  async *streamUpstream(upstream, ctx) { /* parse upstream.body, yield strings */ },
};
```

`ctx` = `{ messages, model, apiKey, stream, raw }`.

**The server owns the OpenAI plumbing** (the `chat.completion` / `chat.completion.chunk`
envelopes and the SSE framing incl. the final `data: [DONE]`). **Your config owns
the arbitrary API mapping.** Clean separation.

### Secrets

The single API key from Settings arrives as the `Authorization: Bearer` header →
`ctx.apiKey`. If your target needs more than one secret, either pack them into
that one field (e.g. `key1:key2` and split in `toUpstream`) or read extras from
`process.env` inside the config.

## Verify

**1. Direct curl**

```bash
curl -s http://localhost:8787/v1/models | jq

# non-streaming
curl -s http://localhost:8787/v1/chat/completions \
  -H 'authorization: Bearer testkey' -H 'content-type: application/json' \
  -d '{"model":"echo-model","messages":[{"role":"user","content":"hi"}]}' | jq

# streaming (SSE)
curl -N http://localhost:8787/v1/chat/completions \
  -H 'authorization: Bearer testkey' -H 'content-type: application/json' \
  -d '{"model":"echo-model","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

**2. Through the open-design daemon (no opencode binary needed)**

Start the daemon (`pnpm tools-dev run web --daemon-port <p> --web-port <p>`), then:

```bash
# model discovery — what Settings calls
curl -s http://localhost:<daemonPort>/api/provider/models \
  -H 'content-type: application/json' \
  -d '{"protocol":"openai","baseUrl":"http://localhost:8787/v1","apiKey":"x"}' | jq

# connection test — the Settings "Test connection" button
curl -s http://localhost:<daemonPort>/api/test/connection \
  -H 'content-type: application/json' \
  -d '{"mode":"provider","protocol":"openai","baseUrl":"http://localhost:8787/v1","apiKey":"x","model":"echo-model"}' | jq
```

These exercise the real daemon-side BYOK paths against the proxy.

**3. Full chat run** requires the `opencode` binary on PATH. When present,
register the proxy in Settings and chat — opencode hits the **same**
`/v1/chat/completions` SSE endpoint validated in step 1.

## Limits

- The final consumer is still opencode/AI-SDK, i.e. the OpenAI wire format. This
  proxy translates *to/from* that format — it does not change what open-design
  itself sends to the proxy.
- Tool/function calling would need `tools` / `tool_calls` mapping added (v1 here
  is text-focused; see the extension points in `server.mjs`).
- Media (image/video/audio) uses a different open-design path (`byok-tools`) and
  is out of scope for this shim.
