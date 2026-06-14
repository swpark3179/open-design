// Web-side FabriX (Samsung SDS) helpers — the browser half of the FabriX
// addon. All credential storage and upstream calls happen daemon-side; this
// module only talks to the daemon's `/api/fabrix/*` routes and derives the
// small bits of presentation the BYOK pickers need.

import type {
  FabrixModelInfo,
  FabrixModelKind,
  FabrixPublicConfig,
} from '@open-design/contracts';
import type { ProviderModelOption } from '../types';

export type { FabrixModelInfo, FabrixModelKind, FabrixPublicConfig };

export const FABRIX_PROTOCOL = 'fabrix' as const;

// Sentinel stored in `apiProtocolConfigs.fabrix.apiKey` so the generic BYOK
// gates (missing-key warning, save-enable check, `streamProxyEndpoint`'s
// non-empty guard) treat FabriX as "has a key" even though the real secrets
// live in `~/.open-design/fabrix.json` and never reach the browser.
export const FABRIX_MANAGED_API_KEY = '__fabrix_managed__';

// Custom DOM event the FabriX settings panel fires after it saves / fetches /
// selects, so the app shell can re-pull the masked config and refresh both
// model switchers without a reload. Mirrors the AMR login-status event seam.
export const FABRIX_CONFIG_CHANGED_EVENT = 'od:fabrix-config-changed';

export function notifyFabrixConfigChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FABRIX_CONFIG_CHANGED_EVENT));
}

// Must match the `providerModelsInputKey` formula in InlineModelSwitcher so
// the cached FabriX models resolve under the same key the switcher looks up.
export function fabrixModelsCacheKey(endpointUrl: string): string {
  return [
    'fabrix',
    endpointUrl.trim().replace(/\/+$/, ''),
    FABRIX_MANAGED_API_KEY,
    '',
  ].join('\n');
}

/**
 * True when a model advertises the given capability type (e.g. `T2I`, `I2T`).
 * Filtering the per-surface pickers by raw `types` rather than the derived
 * `kind` matters because a model can carry several types at once, while
 * `kind` collapses to a single T2I > I2T > TEXT priority.
 */
export function fabrixModelHasType(model: FabrixModelInfo, type: string): boolean {
  return model.types.some((t) => t.toUpperCase() === type.toUpperCase());
}

/** Concise capability label derived from a model's routing kind. */
export function fabrixModelKindLabel(kind: FabrixModelKind): string {
  switch (kind) {
    case 't2i':
      return '이미지 생성 전용';
    case 'i2t':
      return '텍스트 + 이미지 분석';
    default:
      return '텍스트 전용';
  }
}

/** Combobox label: name + brief description + capability tag. */
export function fabrixModelOptionLabel(model: FabrixModelInfo): string {
  const tag = fabrixModelKindLabel(model.kind);
  const desc = model.description.trim();
  const shortDesc = desc.length > 48 ? `${desc.slice(0, 48)}…` : desc;
  const base = shortDesc ? `${model.name} — ${shortDesc}` : model.name;
  return `${base} · ${tag}`;
}

export function fabrixModelsToOptions(
  models: FabrixModelInfo[],
): ProviderModelOption[] {
  return models.map((m) => ({ id: m.modelId, label: fabrixModelOptionLabel(m) }));
}

// ---------------------------------------------------------------------------
// Daemon API
// ---------------------------------------------------------------------------

interface FabrixConfigEnvelope {
  ok: boolean;
  config?: FabrixPublicConfig;
  error?: { code: string; message: string };
  status?: number;
  fetchedCount?: number;
}

async function readEnvelope(response: Response): Promise<FabrixConfigEnvelope> {
  try {
    return (await response.json()) as FabrixConfigEnvelope;
  } catch {
    return { ok: false, error: { code: 'BAD_RESPONSE', message: 'Invalid daemon response' } };
  }
}

export async function fetchFabrixConfig(): Promise<FabrixPublicConfig | null> {
  try {
    const response = await fetch('/api/fabrix/config');
    if (!response.ok) return null;
    const data = await readEnvelope(response);
    return data.ok && data.config ? data.config : null;
  } catch {
    return null;
  }
}

export interface FabrixCredentialInput {
  endpointUrl?: string;
  xFabrixClient?: string;
  xOpenapiToken?: string;
}

export async function saveFabrixConfig(
  input: FabrixCredentialInput,
): Promise<FabrixPublicConfig | null> {
  try {
    const response = await fetch('/api/fabrix/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await readEnvelope(response);
    return data.ok && data.config ? data.config : null;
  } catch {
    return null;
  }
}

export interface FabrixModelsFetchResult {
  ok: boolean;
  config?: FabrixPublicConfig;
  fetchedCount?: number;
  errorMessage?: string;
}

export async function fetchFabrixModelsFromDaemon(
  input: FabrixCredentialInput,
): Promise<FabrixModelsFetchResult> {
  try {
    const response = await fetch('/api/fabrix/models/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await readEnvelope(response);
    if (data.ok && data.config) {
      return { ok: true, config: data.config, fetchedCount: data.fetchedCount ?? data.config.models.length };
    }
    return { ok: false, errorMessage: data.error?.message ?? `Model fetch failed (${response.status})` };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function selectFabrixModel(
  modelId: string,
): Promise<FabrixPublicConfig | null> {
  try {
    const response = await fetch('/api/fabrix/select-model', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    const data = await readEnvelope(response);
    return data.ok && data.config ? data.config : null;
  } catch {
    return null;
  }
}

export interface FabrixDefaultsInput {
  /** T2I (image generation) model id; null clears, omit to preserve. */
  defaultT2iModelId?: string | null;
  /** I2T (image analysis) model id; null clears, omit to preserve. */
  defaultI2tModelId?: string | null;
}

/**
 * Persist the per-surface image model picks. The generation pick becomes the
 * top-priority default image model for any mid-chat / media-surface
 * generation once FabriX is configured (resolved daemon-side).
 */
export async function setFabrixDefaultModels(
  input: FabrixDefaultsInput,
): Promise<FabrixPublicConfig | null> {
  try {
    const response = await fetch('/api/fabrix/defaults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await readEnvelope(response);
    return data.ok && data.config ? data.config : null;
  } catch {
    return null;
  }
}
