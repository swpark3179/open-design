// Echo config — NO real upstream. Proves the open-design → proxy pipe works
// (model list, connection-test smoke, and SSE streaming) without needing any
// external API. Swap in config.example.mjs to target a real API.

export const config = {
  port: 8787,

  // Shown in open-design Settings' model dropdown (GET /v1/models).
  async models() {
    return [
      { id: 'echo-model', label: 'Echo Model' },
      { id: 'echo-fast', label: 'Echo Fast' },
    ];
  },

  // Return null -> no real HTTP call; we fabricate the answer below.
  toUpstream() {
    return null;
  },

  // Non-streaming reply (used by connection test + non-stream chat).
  async fromUpstream(_upstream, ctx) {
    const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user');
    return { content: `echo: ${lastUser?.content ?? ''}` };
  },

  // Streaming reply (used by the real chat run — opencode sends stream:true).
  async *streamUpstream(_upstream, ctx) {
    const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user');
    const text = `echo: ${lastUser?.content ?? ''}`;
    for (const token of text.split(/(\s+)/)) {
      if (token) yield token;
    }
  },
};
