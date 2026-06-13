// Live FabriX (Samsung SDS BYOK) image-model catalogue for the media pickers.
//
// FabriX models are not in the static IMAGE_MODELS registry — they are
// discovered per-user from the FabriX credential store and exposed by the
// daemon at GET /api/media/providers/fabrix/models. Each returned id is
// `fabrix:<modelId>` and routes through the FabriX media bridge in the daemon:
//   * kind t2i → image generation (caps t2i)
//   * kind i2t → image analysis    (caps i2t, needs a reference image)
//
// Results are cached at module scope (one fetch per page load) and surfaced via
// a hook so every picker shares the same list. Mirrors aihubmix-image-models.ts.
import { useEffect, useState } from 'react';
import { IMAGE_MODELS, type MediaModel } from './models';

type FetchedFabrixModel = {
  id: string;
  label: string;
  kind?: 't2i' | 'i2t';
  caps?: string[];
};

function toMediaModel(m: FetchedFabrixModel): MediaModel {
  const isAnalysis = m.kind === 'i2t';
  return {
    id: m.id,
    label: m.label,
    hint: isAnalysis ? 'FabriX · image analysis' : 'FabriX · image generation',
    provider: 'fabrix',
    caps: Array.isArray(m.caps) && m.caps.length ? m.caps : isAnalysis ? ['i2t'] : ['t2i'],
  };
}

export async function fetchFabrixImageModels(
  signal?: AbortSignal,
): Promise<MediaModel[]> {
  const res = await fetch('/api/media/providers/fabrix/models', { signal });
  if (!res.ok) throw new Error(`fabrix models ${res.status}`);
  const payload = (await res.json()) as { models?: FetchedFabrixModel[] };
  const rows = Array.isArray(payload?.models) ? payload.models : [];
  return rows
    .filter((m) => typeof m?.id === 'string' && m.id)
    .map(toMediaModel);
}

/**
 * Merge a live FabriX list into a base registry array. FabriX has no static
 * seeds, so this just appends the fetched list (de-duped by id). When the
 * fetch hasn't resolved (or failed), `dynamic` is empty and the base array is
 * returned unchanged.
 */
export function mergeFabrixModels(
  base: MediaModel[],
  dynamic: MediaModel[],
): MediaModel[] {
  if (!dynamic.length) return base;
  const seen = new Set(base.map((m) => m.id));
  const fresh = dynamic.filter((m) => !seen.has(m.id));
  return fresh.length ? [...base, ...fresh] : base;
}

let cachedModels: MediaModel[] | null = null;
let inFlight: Promise<MediaModel[]> | null = null;

function loadOnce(): Promise<MediaModel[]> {
  if (cachedModels && cachedModels.length) return Promise.resolve(cachedModels);
  if (!inFlight) {
    inFlight = fetchFabrixImageModels()
      .then((models) => {
        cachedModels = models;
        return models;
      })
      .catch((err) => {
        inFlight = null; // allow retry on next mount
        throw err;
      });
  }
  return inFlight;
}

/**
 * Hook returning the live FabriX image models (empty until the first fetch
 * resolves, or if FabriX isn't configured). Safe to call from any picker; the
 * underlying request is shared across mounts.
 */
export function useFabrixImageModels(enabled = true): MediaModel[] {
  const [models, setModels] = useState<MediaModel[]>(() => cachedModels ?? []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadOnce()
      .then((fetched) => {
        if (active) setModels(fetched);
      })
      .catch(() => {
        // Non-fatal: FabriX simply contributes no picker entries.
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  return models;
}

/** Convenience: IMAGE_MODELS merged with the live FabriX catalogue. */
export function useImageModelsWithFabrix(enabled = true): MediaModel[] {
  const dynamic = useFabrixImageModels(enabled);
  return mergeFabrixModels(IMAGE_MODELS, dynamic);
}
