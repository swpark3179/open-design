// FabriX HTTP surface.
//
// Self-contained route module (addon seam): everything FabriX-specific lives
// here and in `./config` / `./client`, so re-applying this feature after an
// Open Design version bump is a matter of dropping the `fabrix/` folder back
// in and re-adding the single `registerFabrixRoutes(...)` call in server.ts.
//
// Routes:
//   GET  /api/fabrix/config        → masked config (never returns secrets)
//   PUT  /api/fabrix/config        → save endpoint + secrets (empty preserves)
//   POST /api/fabrix/models/fetch  → call all-models (non-proxy), cache, return
//   POST /api/fabrix/select-model  → persist the chosen model id
//   POST /api/proxy/fabrix/stream  → chat: routes text vs multipart by model type

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  findModel,
  pickDefaultModels,
  readFabrixConfig,
  toPublicConfig,
  writeFabrixConfig,
  type FabrixStoredConfig,
} from './config.js';
import {
  fetchFabrixModels,
  FabrixUpstreamError,
  generateFabrixImage,
  streamFabrixImageAnalysis,
  streamFabrixText,
  type FabrixChatHandlers,
} from './client.js';
import { ensureProject } from '../projects.js';

export interface RegisterFabrixRoutesDeps {
  /** Absolute path to the projects root (for writing generated images). */
  projectsRoot: string;
}

function sendJson(res: Response, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.status(status).json(body);
}

function sendError(res: Response, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

function isValidEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Merge a save/fetch request's optional secrets onto the stored config. An
// omitted or empty secret PRESERVES the stored value — this is what lets the
// UI update the endpoint (or re-fetch) without ever being shown, or having to
// re-type, the two credentials it loaded from disk.
function mergeCredentials(
  stored: FabrixStoredConfig,
  body: { endpointUrl?: unknown; xFabrixClient?: unknown; xOpenapiToken?: unknown },
): FabrixStoredConfig {
  const endpointUrl =
    typeof body.endpointUrl === 'string' && body.endpointUrl.trim()
      ? body.endpointUrl.trim()
      : stored.endpointUrl;
  const xFabrixClient =
    typeof body.xFabrixClient === 'string' && body.xFabrixClient.trim()
      ? body.xFabrixClient.trim()
      : stored.xFabrixClient;
  const xOpenapiToken =
    typeof body.xOpenapiToken === 'string' && body.xOpenapiToken.trim()
      ? body.xOpenapiToken.trim()
      : stored.xOpenapiToken;
  return { ...stored, endpointUrl, xFabrixClient, xOpenapiToken };
}

// Minimal SSE response writer. Mirrors the daemon proxy event contract
// (`start` / `delta` / `error` / `end`) the web `streamProxyEndpoint`
// consumer already understands.
function openSse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const canWrite = () => !res.destroyed && !res.writableEnded;
  return {
    send(event: string, data: unknown) {
      if (!canWrite()) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (canWrite()) res.end();
    },
  };
}

export function registerFabrixRoutes(app: Express, deps: RegisterFabrixRoutesDeps): void {
  const { projectsRoot } = deps;

  app.get('/api/fabrix/config', async (_req: Request, res: Response) => {
    const stored = await readFabrixConfig();
    sendJson(res, 200, { ok: true, config: toPublicConfig(stored) });
  });

  app.put('/api/fabrix/config', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof body.endpointUrl === 'string' &&
      body.endpointUrl.trim() &&
      !isValidEndpoint(body.endpointUrl.trim())
    ) {
      return sendError(res, 400, 'BAD_REQUEST', 'endpointUrl must be a valid http(s) URL');
    }
    const stored = await readFabrixConfig();
    const next = mergeCredentials(stored, body);
    await writeFabrixConfig(next);
    sendJson(res, 200, { ok: true, config: toPublicConfig(next) });
  });

  app.post('/api/fabrix/models/fetch', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof body.endpointUrl === 'string' &&
      body.endpointUrl.trim() &&
      !isValidEndpoint(body.endpointUrl.trim())
    ) {
      return sendError(res, 400, 'BAD_REQUEST', 'endpointUrl must be a valid http(s) URL');
    }
    const stored = await readFabrixConfig();
    const merged = mergeCredentials(stored, body);
    if (!merged.endpointUrl) {
      return sendError(res, 400, 'BAD_REQUEST', 'Endpoint URL is required');
    }
    if (!merged.xFabrixClient || !merged.xOpenapiToken) {
      return sendError(
        res,
        400,
        'BAD_REQUEST',
        'x-fabrix-client and x-openapi-token are required',
      );
    }
    try {
      const models = await fetchFabrixModels(merged);
      const defaults = pickDefaultModels(models);
      // Keep the prior selection if it still exists; otherwise fall back to
      // the first text model so chat works immediately after a fetch.
      const selectedStillValid =
        merged.selectedModelId && models.some((m) => m.modelId === merged.selectedModelId);
      const selectedModelId = selectedStillValid
        ? merged.selectedModelId
        : defaults.defaultTextModelId ?? models[0]?.modelId ?? null;
      const next: FabrixStoredConfig = {
        ...merged,
        models,
        ...defaults,
        selectedModelId,
      };
      await writeFabrixConfig(next);
      sendJson(res, 200, {
        ok: true,
        config: toPublicConfig(next),
        fetchedCount: models.length,
      });
    } catch (err) {
      const status = err instanceof FabrixUpstreamError ? err.status : undefined;
      sendJson(res, 200, {
        ok: false,
        error: {
          code: 'FABRIX_FETCH_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
        ...(status ? { status } : {}),
      });
    }
  });

  app.post('/api/fabrix/select-model', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
    if (!modelId) return sendError(res, 400, 'BAD_REQUEST', 'modelId is required');
    const stored = await readFabrixConfig();
    const next: FabrixStoredConfig = { ...stored, selectedModelId: modelId };
    await writeFabrixConfig(next);
    sendJson(res, 200, { ok: true, config: toPublicConfig(next) });
  });

  app.post('/api/proxy/fabrix/stream', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
    const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : '';
    const maxTokens =
      typeof body.maxTokens === 'number' && body.maxTokens > 0 ? body.maxTokens : undefined;
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const contents = rawMessages
      .map((m) =>
        m && typeof m === 'object' ? String((m as Record<string, unknown>).content ?? '') : '',
      )
      .filter((c) => c.length > 0);

    const stored = await readFabrixConfig();
    const sse = openSse(res);

    if (!toPublicConfig(stored).configured) {
      sse.send('error', {
        message: 'FabriX is not configured. Open Settings and connect FabriX first.',
        error: { code: 'NOT_CONFIGURED', message: 'FabriX is not configured.' },
      });
      return sse.end();
    }

    const model = requestedModel || stored.selectedModelId || '';
    if (!model) {
      sse.send('error', {
        message: 'No FabriX model selected.',
        error: { code: 'NO_MODEL', message: 'No FabriX model selected.' },
      });
      return sse.end();
    }
    if (contents.length === 0) {
      sse.send('error', {
        message: 'Empty request.',
        error: { code: 'EMPTY_REQUEST', message: 'Empty request.' },
      });
      return sse.end();
    }

    const modelInfo = findModel(stored, model);
    const kind = modelInfo?.kind ?? 'text';
    const leadTextModel =
      stored.defaultTextModelId && stored.defaultTextModelId !== model
        ? stored.defaultTextModelId
        : null;
    const multipartModelIds = leadTextModel ? [leadTextModel, model] : [model];

    const handlers: FabrixChatHandlers = {
      onStart: (m) => sse.send('start', { model: m }),
      onDelta: (delta) => sse.send('delta', { delta }),
      onDone: () => {
        sse.send('end', {});
        sse.end();
      },
      onError: (message, status) => {
        sse.send('error', {
          message,
          error: { code: 'UPSTREAM_UNAVAILABLE', message },
          ...(status ? { status } : {}),
        });
        sse.end();
      },
    };

    try {
      if (kind === 't2i') {
        // Image generation: non-streaming multipart → write image into the
        // active project and surface it as a markdown image so the chat
        // renders it inline (same pattern as the SenseAudio image tool).
        sse.send('start', { model });
        const lastPrompt = contents[contents.length - 1] ?? '';
        const result = await generateFabrixImage(stored, multipartModelIds, [lastPrompt], {
          maxTokens,
        });
        const bytes = Buffer.from(result.base64, 'base64');
        if (projectId) {
          const dir = await ensureProject(projectsRoot, projectId);
          const filename = `fabrix-${randomBytes(6).toString('hex')}.png`;
          await writeFile(path.join(dir, filename), bytes);
          const url = `/api/projects/${encodeURIComponent(projectId)}/files/${filename}`;
          sse.send('delta', { delta: `![FabriX image](${url})\n` });
        } else {
          sse.send('delta', {
            delta: `![FabriX image](data:image/png;base64,${result.base64})\n`,
          });
        }
        sse.send('end', {});
        return sse.end();
      }

      if (kind === 'i2t') {
        // Image analysis: multipart streaming. The chat surface does not yet
        // forward attachments to BYOK proxies, so files are empty for now;
        // the text prompt still routes through the multipart endpoint per the
        // model's capability type.
        await streamFabrixImageAnalysis(
          stored,
          multipartModelIds,
          systemPrompt,
          [contents[contents.length - 1] ?? ''],
          [],
          maxTokens,
          handlers,
        );
        return;
      }

      // Plain text conversation.
      await streamFabrixText(stored, model, systemPrompt, contents, maxTokens, handlers);
    } catch (err) {
      handlers.onError(err instanceof Error ? err.message : String(err));
    }
  });
}
