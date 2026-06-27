/**
 * Custom BYOK provider client. The provider's endpoint, headers (including the
 * API key as a fixed value), request body template, and response
 * text-extraction path all live in the daemon-side config file
 * (`~/.open-design/byok-providers.local.json`). The browser only names which
 * provider + model to use; the daemon owns everything else.
 *
 * Routes through `POST /api/proxy/custom/stream`, which issues one
 * non-streaming upstream request, extracts the text, and replays it as a
 * single SSE `delta` — so this consumer reads the same `delta`/`error`/`end`
 * frames as every other BYOK provider.
 */
import { effectiveMaxTokens } from '../state/maxTokens';
import type { AppConfig, ChatMessage } from '../types';
import type {
  CustomByokProviderInfo,
  CustomByokProvidersResponse,
  ProxyMessage,
} from '@open-design/contracts';
import type { StreamHandlers } from './anthropic';
import { parseSseFrame } from './sse';

// Fetch the daemon-defined custom providers (label + models only — never the
// endpoint, headers, or secrets). Returns [] on any error so the picker simply
// shows nothing rather than throwing.
export async function listCustomByokProviders(): Promise<CustomByokProviderInfo[]> {
  try {
    const resp = await fetch('/api/byok/custom-providers', { cache: 'no-store' });
    if (!resp.ok) return [];
    const json = (await resp.json()) as CustomByokProvidersResponse;
    return Array.isArray(json.providers) ? json.providers : [];
  } catch {
    return [];
  }
}

export async function streamMessageCustom(
  cfg: AppConfig,
  system: string,
  history: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  const providerId = cfg.customProviderId?.trim();
  if (!providerId) {
    handlers.onError(new Error('No custom provider selected — open Settings and pick one.'));
    return;
  }
  if (!cfg.model?.trim()) {
    handlers.onError(new Error('No model selected for the custom provider.'));
    return;
  }

  const messages: ProxyMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
  let acc = '';

  try {
    const resp = await fetch('/api/proxy/custom/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId,
        model: cfg.model,
        systemPrompt: system,
        messages,
        maxTokens: effectiveMaxTokens(cfg),
      }),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      handlers.onError(new Error(`proxy ${resp.status}: ${text || 'no body'}`));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      while (true) {
        const match = buf.match(/\r?\n\r?\n/);
        if (!match || match.index === undefined) break;
        const frame = buf.slice(0, match.index);
        buf = buf.slice(match.index + match[0].length);

        const parsed = parseSseFrame(frame);
        if (!parsed || parsed.kind !== 'event') continue;

        if (parsed.event === 'delta') {
          const text = String(parsed.data.delta ?? parsed.data.text ?? '');
          if (text) {
            acc += text;
            handlers.onDelta(text);
          }
          continue;
        }
        if (parsed.event === 'error') {
          handlers.onError(new Error(customProxyErrorMessage(parsed.data)));
          return;
        }
        if (parsed.event === 'end') {
          handlers.onDone(acc);
          return;
        }
      }
    }

    handlers.onDone(acc);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    handlers.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

function customProxyErrorMessage(data: Record<string, unknown>): string {
  const nested = data.error;
  if (nested && typeof nested === 'object' && 'message' in nested) {
    const message = (nested as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(data.message ?? 'proxy error');
}
