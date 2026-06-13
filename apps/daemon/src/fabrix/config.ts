// FabriX credential + model-cache persistence.
//
// Per the FabriX requirement, connection info must live under the user's
// home folder at `~/.open-design/fabrix.json` (NOT the project-scoped `.od`
// store) so it survives Open Design version upgrades and is reused on every
// later launch. The two secrets (`x-fabrix-client`, `x-openapi-token`) are
// only ever written here; the masked `toPublicConfig` projection is the only
// thing the browser ever sees, which is what lets the UI hide the secrets
// after they are loaded from this file.
//
// `OD_FABRIX_CONFIG_DIR` overrides the directory (test isolation); otherwise
// the home-folder location is used verbatim regardless of `OD_DATA_DIR` so
// the requirement's "user home folder/.open-design" wording is honored.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  FabrixModelInfo,
  FabrixModelKind,
  FabrixPublicConfig,
} from '@open-design/contracts';

export interface FabrixStoredConfig {
  endpointUrl: string;
  xFabrixClient: string;
  xOpenapiToken: string;
  selectedModelId: string | null;
  models: FabrixModelInfo[];
  defaultTextModelId: string | null;
  defaultT2iModelId: string | null;
  defaultI2tModelId: string | null;
  updatedAt: number;
}

const EMPTY_CONFIG: FabrixStoredConfig = {
  endpointUrl: '',
  xFabrixClient: '',
  xOpenapiToken: '',
  selectedModelId: null,
  models: [],
  defaultTextModelId: null,
  defaultT2iModelId: null,
  defaultI2tModelId: null,
  updatedAt: 0,
};

export function fabrixConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OD_FABRIX_CONFIG_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), '.open-design');
}

export function fabrixConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(fabrixConfigDir(env), 'fabrix.json');
}

function coerceModel(raw: unknown): FabrixModelInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const modelId = typeof obj.modelId === 'string' ? obj.modelId.trim() : '';
  if (!modelId) return null;
  const types = Array.isArray(obj.types)
    ? obj.types.filter((t: unknown): t is string => typeof t === 'string')
    : [];
  return {
    modelId,
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name : modelId,
    description: typeof obj.description === 'string' ? obj.description : '',
    types,
    kind: deriveModelKind(types),
  };
}

export async function readFabrixConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FabrixStoredConfig> {
  try {
    const raw = await readFile(fabrixConfigPath(env), 'utf8');
    const parsed = JSON.parse(raw) as Partial<FabrixStoredConfig>;
    const models = Array.isArray(parsed.models)
      ? parsed.models.map(coerceModel).filter((m): m is FabrixModelInfo => m != null)
      : [];
    return {
      ...EMPTY_CONFIG,
      ...parsed,
      endpointUrl: typeof parsed.endpointUrl === 'string' ? parsed.endpointUrl.trim() : '',
      xFabrixClient: typeof parsed.xFabrixClient === 'string' ? parsed.xFabrixClient : '',
      xOpenapiToken: typeof parsed.xOpenapiToken === 'string' ? parsed.xOpenapiToken : '',
      selectedModelId:
        typeof parsed.selectedModelId === 'string' && parsed.selectedModelId.trim()
          ? parsed.selectedModelId
          : null,
      models,
      defaultTextModelId: nullableString(parsed.defaultTextModelId),
      defaultT2iModelId: nullableString(parsed.defaultT2iModelId),
      defaultI2tModelId: nullableString(parsed.defaultI2tModelId),
    };
  } catch {
    // Missing / unreadable / malformed file → treat as unconfigured.
    return { ...EMPTY_CONFIG };
  }
}

export async function writeFabrixConfig(
  config: FabrixStoredConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const dir = fabrixConfigDir(env);
  await mkdir(dir, { recursive: true });
  const payload: FabrixStoredConfig = { ...config, updatedAt: Date.now() };
  await writeFile(fabrixConfigPath(env), JSON.stringify(payload, null, 2), 'utf8');
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Derive the routing kind from a model's capability `types`.
 * Priority: an image-generation model (T2I) routes to multipart generation;
 * an image-analysis model (I2T) routes to multipart analysis; anything else
 * is a plain text model. A model may legitimately advertise several types.
 */
export function deriveModelKind(types: readonly string[]): FabrixModelKind {
  const upper = types.map((t) => t.toUpperCase());
  if (upper.includes('T2I')) return 't2i';
  if (upper.includes('I2T')) return 'i2t';
  return 'text';
}

export function hasType(model: FabrixModelInfo, type: string): boolean {
  return model.types.some((t) => t.toUpperCase() === type.toUpperCase());
}

export function toPublicConfig(config: FabrixStoredConfig): FabrixPublicConfig {
  const clientConfigured = config.xFabrixClient.trim().length > 0;
  const tokenConfigured = config.xOpenapiToken.trim().length > 0;
  return {
    configured: clientConfigured && tokenConfigured && config.endpointUrl.trim().length > 0,
    endpointUrl: config.endpointUrl,
    clientConfigured,
    tokenConfigured,
    selectedModelId: config.selectedModelId,
    models: config.models,
    defaultTextModelId: config.defaultTextModelId,
    defaultT2iModelId: config.defaultT2iModelId,
    defaultI2tModelId: config.defaultI2tModelId,
  };
}

/** Pick sensible defaults so multipart calls have a lead text model and a
 *  target for each image surface immediately after a fetch. */
export function pickDefaultModels(models: FabrixModelInfo[]): {
  defaultTextModelId: string | null;
  defaultT2iModelId: string | null;
  defaultI2tModelId: string | null;
} {
  const firstWith = (type: string) =>
    models.find((m) => hasType(m, type))?.modelId ?? null;
  return {
    // A pure-text model is preferred as the lead model id; fall back to any
    // model that advertises TEXT among its types.
    defaultTextModelId:
      models.find((m) => m.kind === 'text')?.modelId ?? firstWith('TEXT'),
    defaultT2iModelId: firstWith('T2I'),
    defaultI2tModelId: firstWith('I2T'),
  };
}

export function findModel(
  config: FabrixStoredConfig,
  modelId: string,
): FabrixModelInfo | null {
  return config.models.find((m) => m.modelId === modelId) ?? null;
}
