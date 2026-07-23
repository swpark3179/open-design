// Skeleton for targeting a REAL, arbitrary API. Copy this file, fill in the
// TODOs, and run:  node server.mjs config.example.mjs
//
// This is where you take full control of path / headers / body — the three
// things open-design's BYOK Settings can NOT customize on their own.
//
// The `ctx` passed to each hook:
//   ctx.messages : OpenAI chat messages  [{ role, content }, ...]
//   ctx.model    : model id the user selected in open-design
//   ctx.apiKey   : the API key typed in open-design Settings (arrives as Bearer)
//   ctx.stream   : boolean
//   ctx.raw      : the full original OpenAI request body

export const config = {
  port: 8787,

  // GET /v1/models — what open-design's Settings dropdown shows.
  // Either return a static list, or fetch your provider's catalogue here.
  async models({ apiKey }) {
    // TODO: replace with your real model ids (or a live fetch).
    return [{ id: 'my-model', label: 'My Model' }];
    //
    // Live-fetch example:
    // const r = await fetch('https://target.example.com/models', {
    //   headers: { 'x-custom-auth': apiKey },
    // });
    // const j = await r.json();
    // return j.items.map((m) => ({ id: m.name, label: m.name }));
  },

  // Map an incoming OpenAI chat request to YOUR upstream call.
  // Return { url, method?, headers?, body? }. Return null for "no upstream".
  toUpstream(ctx) {
    // TODO: build the request your target API actually expects.
    return {
      url: 'https://target.example.com/v2/generate', // any path
      method: 'POST',
      headers: {
        // any headers — this is the whole point of approach B
        'x-custom-auth': ctx.apiKey,
        'x-tenant': 'my-tenant',
        // 'x-extra-secret': process.env.MY_EXTRA_SECRET ?? '',
      },
      body: {
        // any body shape
        prompt: ctx.messages.map((m) => `${m.role}: ${m.content}`).join('\n'),
        model: ctx.model,
        stream: ctx.stream,
      },
    };
  },

  // Non-streaming: turn the upstream Response into assistant text.
  // `upstream` is a WHATWG fetch Response (or null if toUpstream returned null).
  async fromUpstream(upstream, _ctx) {
    const json = await upstream.json();
    // TODO: pull the text out of YOUR response shape.
    return { content: json.output?.text ?? JSON.stringify(json) };
  },

  // Streaming: yield text deltas. `upstream` is the raw fetch Response, so you
  // can read upstream.body and parse whatever streaming format the target uses.
  async *streamUpstream(upstream, ctx) {
    // Simplest correct fallback: if the target does not stream, just emit the
    // whole non-streamed answer as one delta.
    if (!upstream) {
      const out = await this.fromUpstream?.(upstream, ctx);
      if (out?.content) yield out.content;
      return;
    }

    // Example: target emits Server-Sent Events with `data: {json}` lines whose
    // json has `.delta`. Adapt the parsing to your target's real format.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const obj = JSON.parse(payload);
          // TODO: extract the incremental text from YOUR chunk shape.
          const piece = obj.delta ?? obj.choices?.[0]?.delta?.content ?? '';
          if (piece) yield piece;
        } catch {
          // ignore keep-alive / non-JSON lines
        }
      }
    }
  },
};
