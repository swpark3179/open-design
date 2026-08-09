import type { Express, RequestHandler } from 'express';
import {
  isClosedNetworkCapabilityDisabled,
  type ClosedNetworkCapability,
  type ClosedNetworkStatus,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';

export interface RegisterClosedNetworkRoutesDeps extends RouteDeps<'closedNetwork'> {}

/**
 * Read-only view of the daemon's boot-time closed-network decision.
 *
 * The web app calls this once on load to decide which surfaces to hide; the
 * `od closed-network status` subcommand reads the same answer. There is no PUT:
 * the mode is owned by a marker file (or the env var) and only changes across a
 * daemon restart, so a mutable endpoint would be able to lie about the running
 * process's actual egress behavior.
 *
 * Same visibility class as `/api/daemon/status` — local runtime facts, no
 * credentials — so it carries no extra auth guard.
 */
export function registerClosedNetworkRoutes(
  app: Express,
  ctx: RegisterClosedNetworkRoutesDeps,
): void {
  app.get('/api/closed-network', (_req, res) => {
    const payload: ClosedNetworkStatus = ctx.closedNetwork;
    res.json(payload);
  });
}

/**
 * Express guard for a route whose whole purpose is to reach a host a
 * closed-network deployment cannot talk to — a marketplace registry on
 * raw.githubusercontent.com, a codeload tarball, a community catalog.
 *
 * The matching UI entry points are hidden, so this is the belt to that
 * suspenders: it turns a request that would otherwise hang until a DNS or TLS
 * timeout into an immediate, correctly-typed refusal. Off by default — when the
 * capability is live the handler is a plain pass-through.
 */
export function requireClosedNetworkCapability(deps: {
  closedNetwork: ClosedNetworkStatus | null | undefined;
  capability: ClosedNetworkCapability;
  sendApiError: (...args: any[]) => any;
  message: string;
}): RequestHandler {
  const blocked = isClosedNetworkCapabilityDisabled(deps.closedNetwork, deps.capability);
  if (!blocked) return (_req, _res, next) => next();
  return (_req, res) => {
    deps.sendApiError(res, 503, 'CLOSED_NETWORK_BLOCKED', deps.message);
  };
}
