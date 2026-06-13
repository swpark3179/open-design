/**
 * FabriX (Samsung SDS) chat provider.
 *
 * Routes through the daemon proxy at `/api/proxy/fabrix/stream`. Unlike the
 * other BYOK providers, no credentials are sent in the request body — the
 * daemon reads the two FabriX headers from `~/.open-design/fabrix.json` and
 * makes the upstream call directly (forced non-proxy). The daemon also decides
 * text vs. multipart (image) routing from the selected model's capability
 * type, so the browser just forwards the conversation and the model id.
 */
import type { AppConfig, ChatMessage } from '../types';
import type { StreamHandlers } from './anthropic';
import { streamProxyEndpoint, type ProxyContext } from './api-proxy';

export async function streamMessageFabrix(
  cfg: AppConfig,
  system: string,
  history: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
  context?: ProxyContext,
): Promise<void> {
  return streamProxyEndpoint(
    '/api/proxy/fabrix/stream',
    cfg,
    system,
    history,
    signal,
    handlers,
    context,
  );
}
