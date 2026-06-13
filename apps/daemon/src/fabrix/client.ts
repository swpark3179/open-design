// FabriX upstream client — forced non-proxy.
//
// Requirement: every FabriX API call must bypass any HTTP(S) proxy. The rest
// of the daemon's BYOK proxies build an `EnvHttpProxyAgent` (which honors
// `HTTP_PROXY` / `HTTPS_PROXY`). Here we instead pass a plain undici `Agent`
// as the per-request `dispatcher`, which overrides any global proxy
// dispatcher and connects directly to the configured endpoint. The endpoint
// is a user-owned enterprise gateway, so — unlike the generic proxies — we do
// NOT apply the internal-IP SSRF block (on-prem FabriX gateways frequently
// live on private ranges).

import { Agent } from 'undici';
import {
  deriveModelKind,
  type FabrixStoredConfig,
} from './config.js';
import type { FabrixModelInfo } from '@open-design/contracts';

// Endpoint suffixes. Kept as named constants so the (mildly inconsistent)
// upstream docs can be reconciled in one place. The python reference samples
// all POST to `message-with-models` (singular "message"), so that is the
// default for the multipart surface.
const ALL_MODELS_PATH = '/openapi/chat/v1/all-models';
const MESSAGES_PATH = '/openapi/chat/v1/messages';
const MESSAGE_WITH_MODELS_PATH = '/openapi/chat/v1/message-with-models';

const FETCH_TIMEOUT_MS = 30_000;

// Reused across requests; a plain Agent never routes through a proxy.
let directAgent: Agent | null = null;
function getDirectAgent(): Agent {
  if (!directAgent) directAgent = new Agent();
  return directAgent;
}

// Inject the forced-direct dispatcher and cast once. The cast both satisfies
// undici's `RequestInit.dispatcher` augmentation and sidesteps
// `exactOptionalPropertyTypes` noise from spreading optional init fields.
function directInit(init: RequestInit): RequestInit {
  return { ...init, dispatcher: getDirectAgent() } as unknown as RequestInit;
}

function joinUrl(endpointUrl: string, suffix: string): string {
  const base = endpointUrl.trim().replace(/\/+$/, '');
  return `${base}${suffix}`;
}

function authHeaders(config: FabrixStoredConfig): Record<string, string> {
  return {
    'x-fabrix-client': config.xFabrixClient,
    'x-openapi-token': config.xOpenapiToken,
  };
}

export class FabrixUpstreamError extends Error {
  status?: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FabrixUpstreamError';
    this.status = status;
  }
}

function withTimeout(signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timer.unref?.();
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

function pickLocalized(list: unknown): string {
  // `name` / `description` arrive as [{ languageCode, content }]. Prefer
  // Korean, then English, then the first available entry.
  if (typeof list === 'string') return list;
  if (!Array.isArray(list)) return '';
  const entries = list
    .map((e) =>
      e && typeof e === 'object'
        ? {
            lang: String((e as Record<string, unknown>).languageCode ?? '').toLowerCase(),
            content: String((e as Record<string, unknown>).content ?? ''),
          }
        : null,
    )
    .filter((e): e is { lang: string; content: string } => e != null && e.content.length > 0);
  if (entries.length === 0) return '';
  return (
    entries.find((e) => e.lang === 'ko')?.content ??
    entries.find((e) => e.lang.startsWith('en'))?.content ??
    entries[0]!.content
  );
}

function extractModelArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['data', 'models', 'result', 'results', 'contents', 'list', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    // Fall back to the first array-of-objects property that looks like models.
    for (const value of Object.values(obj)) {
      if (
        Array.isArray(value) &&
        value.some((v) => v && typeof v === 'object' && 'modelId' in (v as object))
      ) {
        return value;
      }
    }
  }
  return [];
}

export function parseFabrixModels(data: unknown): FabrixModelInfo[] {
  const out: FabrixModelInfo[] = [];
  const seen = new Set<string>();
  for (const raw of extractModelArray(data)) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const modelId =
      typeof obj.modelId === 'string'
        ? obj.modelId.trim()
        : typeof obj.id === 'string'
          ? obj.id.trim()
          : '';
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    const types = Array.isArray(obj.types)
      ? obj.types.filter((t: unknown): t is string => typeof t === 'string')
      : [];
    const name = pickLocalized(obj.name) || modelId;
    // Tolerate the documented `descrption` typo alongside `description`.
    const description = pickLocalized(obj.description ?? obj.descrption);
    out.push({ modelId, name, description, types, kind: deriveModelKind(types) });
  }
  return out;
}

export async function fetchFabrixModels(
  config: FabrixStoredConfig,
  signal?: AbortSignal,
): Promise<FabrixModelInfo[]> {
  const { signal: timeoutSignal, done } = withTimeout(signal);
  try {
    const response = await fetch(
      joinUrl(config.endpointUrl, ALL_MODELS_PATH),
      directInit({
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(config),
        },
        signal: timeoutSignal,
      }),
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new FabrixUpstreamError(
        `FabriX model fetch failed (${response.status})${text ? `: ${text.slice(0, 240)}` : ''}`,
        response.status,
      );
    }
    const data = await response.json().catch(() => null);
    return parseFabrixModels(data);
  } finally {
    done();
  }
}

// ---------------------------------------------------------------------------
// Chat — text (streaming SSE)
// ---------------------------------------------------------------------------

export interface FabrixChatHandlers {
  onStart?: (modelId: string) => void;
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (message: string, status?: number) => void;
}

const DEFAULT_LLM_CONFIG = {
  max_new_tokens: 2024,
  seed: null,
  top_k: 14,
  top_p: 0.94,
  temperature: 0.4,
  repetition_penalty: 1.04,
};

function llmConfigWithTokens(maxTokens?: number): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...DEFAULT_LLM_CONFIG };
  if (typeof maxTokens === 'number' && maxTokens > 0) cfg.max_new_tokens = maxTokens;
  return cfg;
}

// Parse a FabriX SSE stream. Each `data:` payload is JSON shaped like
// `{ status, response_code, event_status, content }`. Emits `content` on
// CHUNK events and stops on the SUCCESS / R20000 terminal event.
async function consumeFabrixSse(
  response: Response,
  handlers: Pick<FabrixChatHandlers, 'onDelta' | 'onDone' | 'onError'>,
): Promise<void> {
  if (!response.body) {
    handlers.onError('FabriX returned an empty response body');
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;

  const handlePayload = (payload: string) => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === '[DONE]') {
      if (trimmed === '[DONE]') {
        handlers.onDone();
        ended = true;
      }
      return;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    const content = typeof json.content === 'string' ? json.content : '';
    const eventStatus = String(json.event_status ?? json.eventStatus ?? '');
    if (eventStatus.toUpperCase() === 'CHUNK' && content) {
      handlers.onDelta(content);
    }
    const status = String(json.status ?? '').toUpperCase();
    // Normalize case like `status`/`event_status` above so the terminal
    // detection survives a mixed-case `r20000` from the upstream gateway.
    const responseCode = String(json.response_code ?? json.responseCode ?? '').toUpperCase();
    if (status === 'SUCCESS' && responseCode === 'R20000') {
      handlers.onDone();
      ended = true;
    } else if (status === 'FAILED' || status === 'ERROR') {
      const message =
        (typeof json.message === 'string' && json.message) ||
        (typeof json.content === 'string' && json.content) ||
        'FabriX stream error';
      handlers.onError(message);
      ended = true;
    }
  };

  const flushFrame = (frame: string) => {
    const lines = frame.replace(/\r/g, '').split('\n');
    const dataLines: string[] = [];
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let value = line.slice(5);
      if (value.startsWith(' ')) value = value.slice(1);
      dataLines.push(value);
    }
    if (dataLines.length > 0) handlePayload(dataLines.join('\n'));
  };

  while (!ended) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let match = buffer.match(/\r?\n\r?\n/);
    while (match && match.index !== undefined) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      flushFrame(frame);
      if (ended) break;
      match = buffer.match(/\r?\n\r?\n/);
    }
  }
  if (!ended) {
    const tail = buffer.trim();
    if (tail) flushFrame(tail);
    if (!ended) handlers.onDone();
  }
}

export async function streamFabrixText(
  config: FabrixStoredConfig,
  modelId: string,
  systemPrompt: string,
  contents: string[],
  maxTokens: number | undefined,
  handlers: FabrixChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { signal: timeoutSignal, done } = withTimeout(signal);
  try {
    handlers.onStart?.(modelId);
    const body = {
      modelIds: [modelId],
      contents,
      llmConfig: llmConfigWithTokens(maxTokens),
      isStream: true,
      ...(systemPrompt ? { systemPrompt } : {}),
    };
    const response = await fetch(
      joinUrl(config.endpointUrl, MESSAGES_PATH),
      directInit({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(config),
        },
        body: JSON.stringify(body),
        signal: timeoutSignal,
      }),
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      handlers.onError(
        `FabriX upstream error (${response.status})${text ? `: ${text.slice(0, 240)}` : ''}`,
        response.status,
      );
      return;
    }
    await consumeFabrixSse(response, handlers);
  } finally {
    done();
  }
}

// ---------------------------------------------------------------------------
// Chat — multipart (image analysis I2T / image generation T2I)
// ---------------------------------------------------------------------------

export interface FabrixMultipartFile {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

function buildMultipartForm(args: {
  modelIds: string[];
  contents: string[];
  systemPrompt?: string | undefined;
  isStream: boolean;
  maxTokens?: number | undefined;
  messageConfig?: Record<string, unknown> | undefined;
  files?: FabrixMultipartFile[] | undefined;
}): FormData {
  const form = new FormData();
  for (const id of args.modelIds) form.append('modelIds', id);
  for (const content of args.contents) form.append('contents', content);
  form.append('llmConfig', JSON.stringify(llmConfigWithTokens(args.maxTokens)));
  form.append('isStream', args.isStream ? 'true' : 'false');
  if (args.messageConfig) {
    form.append('messageConfig', JSON.stringify(args.messageConfig));
  }
  if (args.systemPrompt) form.append('systemPrompt', args.systemPrompt);
  for (const file of args.files ?? []) {
    // Copy into a fresh ArrayBuffer-backed Blob so the typed-array view is
    // not retained beyond the request.
    const blob = new Blob([new Uint8Array(file.bytes)], { type: file.contentType });
    form.append('files', blob, file.filename);
  }
  return form;
}

/** Image analysis (I2T): multipart + streaming SSE text, same frame shape as
 *  the text endpoint. */
export async function streamFabrixImageAnalysis(
  config: FabrixStoredConfig,
  modelIds: string[],
  systemPrompt: string,
  contents: string[],
  files: FabrixMultipartFile[],
  maxTokens: number | undefined,
  handlers: FabrixChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { signal: timeoutSignal, done } = withTimeout(signal);
  try {
    handlers.onStart?.(modelIds[modelIds.length - 1] ?? '');
    const form = buildMultipartForm({
      modelIds,
      contents,
      systemPrompt,
      isStream: true,
      maxTokens,
      files,
    });
    const response = await fetch(
      joinUrl(config.endpointUrl, MESSAGE_WITH_MODELS_PATH),
      directInit({
        method: 'POST',
        // NOTE: do NOT set Content-Type — fetch derives the multipart boundary.
        headers: authHeaders(config),
        body: form,
        signal: timeoutSignal,
      }),
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      handlers.onError(
        `FabriX upstream error (${response.status})${text ? `: ${text.slice(0, 240)}` : ''}`,
        response.status,
      );
      return;
    }
    await consumeFabrixSse(response, handlers);
  } finally {
    done();
  }
}

export interface FabrixImageResult {
  base64: string;
}

/** Image generation (T2I): multipart, non-streaming. Returns the base64
 *  payload from `actions[0].answer`. */
export async function generateFabrixImage(
  config: FabrixStoredConfig,
  modelIds: string[],
  contents: string[],
  options: { width?: number | undefined; height?: number | undefined; maxTokens?: number | undefined } = {},
  signal?: AbortSignal,
): Promise<FabrixImageResult> {
  const { signal: timeoutSignal, done } = withTimeout(signal);
  try {
    const form = buildMultipartForm({
      modelIds,
      contents,
      isStream: false,
      maxTokens: options.maxTokens,
      messageConfig: {
        width: options.width ?? 1024,
        height: options.height ?? 1024,
      },
    });
    const response = await fetch(
      joinUrl(config.endpointUrl, MESSAGE_WITH_MODELS_PATH),
      directInit({
        method: 'POST',
        headers: authHeaders(config),
        body: form,
        signal: timeoutSignal,
      }),
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new FabrixUpstreamError(
        `FabriX image generation failed (${response.status})${text ? `: ${text.slice(0, 240)}` : ''}`,
        response.status,
      );
    }
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const actions = data?.actions;
    const answer =
      Array.isArray(actions) && actions[0] && typeof actions[0] === 'object'
        ? (actions[0] as Record<string, unknown>).answer
        : undefined;
    if (typeof answer !== 'string' || !answer) {
      throw new FabrixUpstreamError('FabriX image response did not contain image data');
    }
    return { base64: answer };
  } finally {
    done();
  }
}
