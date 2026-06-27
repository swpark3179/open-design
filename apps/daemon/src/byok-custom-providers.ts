// Custom BYOK providers — config-file-templated LLM endpoints.
//
// Mirrors the `agents.local.json` precedent in
// `runtimes/local-profiles.ts`: the daemon reads a user-authored JSON file
// (default `~/.open-design/byok-providers.local.json`, override via
// `OD_BYOK_PROVIDERS_CONFIG`) that defines one or more *custom* BYOK
// providers. Each provider names its own message-call endpoint, fixed headers
// (API keys live here as fixed values), request-body template, response
// text-extraction path, and model list.
//
// This file is NOT daemon runtime data — it is a user integration input, the
// same category as `OD_AGENT_PROFILES_CONFIG` / `CODEX_HOME`. See the
// "Daemon data directory contract" in AGENTS.md.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { validateBaseUrl } from '@open-design/contracts';
import type {
  CustomByokModelOption,
  CustomByokProviderConfig,
  CustomByokProviderInfo,
  ProxyMessage,
} from '@open-design/contracts';

// Template variables available to header values and the body template.
export interface CustomByokTemplateContext {
  model: string;
  systemPrompt: string;
  prompt: string;
  messages: ProxyMessage[];
  maxTokens: number;
}

function byokProvidersConfigFile(): string {
  const explicit = process.env.OD_BYOK_PROVIDERS_CONFIG;
  if (typeof explicit === 'string' && explicit.trim()) {
    return path.resolve(explicit.trim());
  }
  return path.join(homedir(), '.open-design', 'byok-providers.local.json');
}

function isCleanString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

// Permissive model-id check: provider ids like `gpt-4o`, `internal-7b`,
// `org/model:tag` are all valid. Rejects empty / control-char / overlong ids.
function sanitizeModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeModels(value: unknown): CustomByokModelOption[] {
  if (!Array.isArray(value)) return [];
  const out: CustomByokModelOption[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const rawId =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? (item as { id?: unknown }).id
          : undefined;
    const id = sanitizeModelId(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      item && typeof item === 'object' && typeof (item as { label?: unknown }).label === 'string'
        ? ((item as { label: string }).label.trim() || id)
        : id;
    out.push({ id, label });
  }
  return out;
}

function normalizeHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    // Header field-names per RFC 7230 token grammar; reject anything that
    // could smuggle a CRLF or split the header block.
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      const str = String(raw);
      if (str.includes('\n') || str.includes('\r')) continue;
      out[key] = str;
    }
  }
  return out;
}

// Validate + normalize one raw config entry. Returns null (and logs) when the
// entry is malformed so a single bad provider doesn't break the rest.
function normalizeProvider(raw: unknown): CustomByokProviderConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;

  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) {
    console.warn('[byok-custom] skipping provider: invalid or missing "id"');
    return null;
  }
  const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id;

  const endpoint = isCleanString(entry.endpoint) ? entry.endpoint.trim() : '';
  const urlCheck = validateBaseUrl(endpoint);
  if (urlCheck.error) {
    console.warn(`[byok-custom] skipping provider "${id}": invalid endpoint (${urlCheck.error})`);
    return null;
  }

  const method =
    typeof entry.method === 'string' && /^[A-Za-z]+$/.test(entry.method.trim())
      ? entry.method.trim().toUpperCase()
      : 'POST';

  const headers = normalizeHeaders(entry.headers);
  if (!headers) {
    console.warn(`[byok-custom] skipping provider "${id}": "headers" must be an object`);
    return null;
  }

  if (entry.bodyTemplate === undefined) {
    console.warn(`[byok-custom] skipping provider "${id}": missing "bodyTemplate"`);
    return null;
  }

  const responseTextPath = isCleanString(entry.responseTextPath)
    ? entry.responseTextPath.trim()
    : '';
  if (!responseTextPath) {
    console.warn(`[byok-custom] skipping provider "${id}": missing "responseTextPath"`);
    return null;
  }

  const models = normalizeModels(entry.models);
  if (models.length === 0) {
    console.warn(`[byok-custom] skipping provider "${id}": "models" must list at least one model`);
    return null;
  }

  return {
    id,
    label,
    endpoint,
    method,
    headers,
    bodyTemplate: entry.bodyTemplate,
    responseTextPath,
    models,
  };
}

// Read + parse the config file fresh. Returns [] when the file is absent or
// unreadable so a missing config is simply "no custom providers", not an
// error. Re-reads on every call so users can edit the file without a restart.
export function loadCustomProviders(): CustomByokProviderConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(byokProvidersConfigFile(), 'utf8'));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { providers?: unknown }).providers)
      ? (parsed as { providers: unknown[] }).providers
      : [];
  const out: CustomByokProviderConfig[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const provider = normalizeProvider(raw);
    if (!provider || seen.has(provider.id)) continue;
    seen.add(provider.id);
    out.push(provider);
  }
  return out;
}

// UI/CLI-facing projection: drops endpoint, headers, bodyTemplate, and
// responseTextPath so secrets and wiring never leave the daemon.
export function listCustomProviders(): CustomByokProviderInfo[] {
  return loadCustomProviders().map((p) => ({ id: p.id, label: p.label, models: p.models }));
}

export function getCustomProvider(id: string): CustomByokProviderConfig | null {
  if (typeof id !== 'string' || !id) return null;
  return loadCustomProviders().find((p) => p.id === id) ?? null;
}

const MESSAGES_TOKEN = '{{messages}}';

function interpolateScalars(input: string, ctx: CustomByokTemplateContext): string {
  return input
    .replace(/\{\{\s*model\s*\}\}/g, ctx.model)
    .replace(/\{\{\s*systemPrompt\s*\}\}/g, ctx.systemPrompt)
    .replace(/\{\{\s*prompt\s*\}\}/g, ctx.prompt)
    .replace(/\{\{\s*maxTokens\s*\}\}/g, String(ctx.maxTokens))
    // A {{messages}} embedded inside a larger string is uncommon; fall back to
    // a JSON-encoded array so the result stays valid. Whole-value replacement
    // (handled in renderBody) is the supported path.
    .replace(/\{\{\s*messages\s*\}\}/g, () => JSON.stringify(ctx.messages));
}

// Walk the body template, substituting template variables. A string value that
// is exactly "{{messages}}" is replaced wholesale with the message array;
// every other string is scalar-interpolated.
export function renderBody(template: unknown, ctx: CustomByokTemplateContext): unknown {
  if (typeof template === 'string') {
    if (template.trim() === MESSAGES_TOKEN) return ctx.messages;
    return interpolateScalars(template, ctx);
  }
  if (Array.isArray(template)) {
    return template.map((item) => renderBody(item, ctx));
  }
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      out[key] = renderBody(value, ctx);
    }
    return out;
  }
  return template;
}

export function renderHeaders(
  headers: Record<string, string>,
  ctx: CustomByokTemplateContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = interpolateScalars(value, ctx);
  }
  return out;
}

// Resolve a dotted path (with numeric array indices) into a parsed JSON
// response and return the text at that location. Throws a descriptive Error
// when the path doesn't resolve to a usable scalar so the proxy can surface a
// clear message instead of emitting an empty reply.
export function extractText(json: unknown, dottedPath: string): string {
  const segments = dottedPath.split('.').map((s) => s.trim()).filter((s) => s.length > 0);
  let cursor: unknown = json;
  const walked: string[] = [];
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== 'object') {
      throw new Error(
        `responseTextPath "${dottedPath}" did not resolve: "${walked.join('.') || '<root>'}" is not an object`,
      );
    }
    if (/^\d+$/.test(segment)) {
      if (!Array.isArray(cursor)) {
        throw new Error(
          `responseTextPath "${dottedPath}" did not resolve: expected an array at "${walked.join('.') || '<root>'}"`,
        );
      }
      cursor = cursor[Number(segment)];
    } else {
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    walked.push(segment);
  }
  if (cursor == null) {
    throw new Error(`responseTextPath "${dottedPath}" resolved to null/undefined`);
  }
  if (typeof cursor === 'string') return cursor;
  if (typeof cursor === 'number' || typeof cursor === 'boolean') return String(cursor);
  throw new Error(
    `responseTextPath "${dottedPath}" resolved to a ${Array.isArray(cursor) ? 'array' : typeof cursor}, expected a string`,
  );
}
