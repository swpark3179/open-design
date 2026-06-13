// Shared DTOs for the FabriX (Samsung SDS FabriX) BYOK provider.
//
// FabriX is an enterprise LLM gateway that diverges from the generic BYOK
// protocols in three ways: (1) it authenticates with two custom headers
// (`x-fabrix-client` + `x-openapi-token`) instead of a single bearer key,
// (2) it exposes a model-discovery endpoint whose entries carry capability
// `types` (TEXT / I2T / T2I), and (3) its credentials are owned by the
// daemon and persisted under `~/.open-design/fabrix.json` so the two
// secrets never round-trip back to the browser once stored.
//
// Keeping these shapes in `packages/contracts` honors the repo boundary
// rule (shared web/daemon DTOs live here) while the heavy FabriX request
// logic stays in the daemon's `fabrix/` module and the web's `fabrix/`
// module — an addon seam that re-applies cleanly across version patches.

/** Stable id used as the BYOK protocol key and the daemon route segment. */
export const FABRIX_PROVIDER_ID = 'fabrix';
/** Short label shown in the BYOK provider tabs. */
export const FABRIX_PROVIDER_LABEL = 'FabriX';
/** Full provider name surfaced in the settings panel header. */
export const FABRIX_PROVIDER_FULL_NAME = 'Samsung SDS FabriX';

/**
 * Routing kind derived from a model's `types` list.
 *  - `text` → text-only conversational model → `/openapi/chat/v1/messages`
 *  - `i2t`  → image analysis model → `/openapi/chat/v1/message-with-models`
 *  - `t2i`  → image generation model → `/openapi/chat/v1/message-with-models`
 */
export type FabrixModelKind = 'text' | 'i2t' | 't2i';

export interface FabrixModelInfo {
  modelId: string;
  /** Display name (best-effort localized; falls back to the model id). */
  name: string;
  /** Brief description (best-effort localized; may be empty). */
  description: string;
  /** Raw capability types from the upstream response, e.g. `["TEXT"]`. */
  types: string[];
  /** Routing kind derived from `types` (T2I > I2T > TEXT priority). */
  kind: FabrixModelKind;
}

/**
 * Masked configuration returned to the browser. The raw secret values are
 * never included — only whether each is configured. This is what lets the
 * UI hide `x-fabrix-client` / `x-openapi-token` after they are stored.
 */
export interface FabrixPublicConfig {
  /** True when BOTH secrets are present (chat/fetch can proceed). */
  configured: boolean;
  endpointUrl: string;
  clientConfigured: boolean;
  tokenConfigured: boolean;
  selectedModelId: string | null;
  models: FabrixModelInfo[];
  /** Default TEXT model used as the lead model id in multipart calls. */
  defaultTextModelId: string | null;
  defaultT2iModelId: string | null;
  defaultI2tModelId: string | null;
}

export interface FabrixConfigUpdateRequest {
  endpointUrl?: string;
  /** Omitted or empty preserves the stored value (so the UI can update the
   *  endpoint without re-typing secrets it was never shown). */
  xFabrixClient?: string;
  xOpenapiToken?: string;
}

export type FabrixModelsFetchRequest = FabrixConfigUpdateRequest;

export interface FabrixSelectModelRequest {
  modelId: string;
}

export interface FabrixConfigResponse {
  ok: true;
  config: FabrixPublicConfig;
}

export interface FabrixModelsFetchResponse {
  ok: true;
  config: FabrixPublicConfig;
  fetchedCount: number;
}

export interface FabrixErrorResponse {
  ok: false;
  error: { code: string; message: string };
  /** Upstream HTTP status when the failure originated from FabriX. */
  status?: number;
}
